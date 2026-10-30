import {before, after, test} from "node:test";
import assert from "node:assert/strict";
import {localStack} from "../../scripts/local-stack.mjs";
import {uuid} from "../fixtures/ledger.mjs";
let stack, url, cookies = "", otherCookies = "";
const password = "An-isolated-test-password-123!";
async function request(path, body, jar = cookies, origin = url) {
  const response = await fetch(url + path, {method: body === undefined ? "GET" : "POST", headers: {cookie: jar, ...(body === undefined ? {} : {"content-type":"application/json", origin})}, body: body === undefined ? undefined : JSON.stringify(body)});
  return {status: response.status, body: await response.json(), response};
}
async function post(path, body, expected = 200, jar = cookies) {
  const r = await request(path, body, jar);
  assert.equal(r.status, expected, JSON.stringify(r.body));
  return r.body.data;
}
async function fixture() {
  const w = uuid(), employee = uuid(), bank = uuid(), capital = uuid(), payable = uuid(), expense = uuid(), fee = uuid(), fx = uuid();
  await post("/api/workspaces", {id: w, name: "Payroll extension", kind: "business", functional_currency_code: "THB", timezone: "UTC"});
  const base = "/api/workspaces/" + w;
  for (const [id,name,type,role,currency_code] of [
    [bank,"Bank","asset","bank","THB"],[capital,"Capital","equity","general",null],
    [payable,"Salary MMK","liability","payable","MMK"],[expense,"Salaries","expense","general",null],
    [fee,"Fees","expense","general",null],[fx,"FX","expense","general",null],
  ]) await post(base + "/accounts", {id,name,type,role,currency_code,is_active:true});
  await post(base + "/parties", {id: employee, name: "Example employee"});
  await post(base + "/commands", {type:"guided",post:true,input:{id:uuid(),kind:"contribution",accounting_date:"2026-10-01",description:"Opening capital",party_id:null,source_id:bank,destination_id:capital,amount:"100000",currency:"THB",rate:"1",splits:[]}});
  return {w,employee,bank,capital,payable,expense,fee,fx,base};
}
const salary = (f) => ({id:uuid(),source_id:uuid(),employee_party_id:f.employee,period:"2026-10",accounting_date:"2026-10-31",description:"October salary",payable_account_id:f.payable,expense_account_id:f.expense,amount:"2000000",currency_code:"MMK",exchange_rate:"0.01"});
const payment = (f,a,amount="1000000",funding="8000") => ({id:uuid(),source_id:a.source_id,operation_id:uuid(),accounting_date:"2026-11-01",description:"Mobile salary transfer",allocations:[{amount,funding_account_id:f.bank,funding_amount:funding,funding_rate:"1",provider:"Bank app",provider_rate:"124.9",reference:"Receipt ref"}],fx_account_id:f.fx});
const snapshot = async (f) => (await request(f.base)).body.data;
before(async () => {
  stack = await localStack({auth:true}); url = await stack.startApp();
  for (const other of [false,true]) {
    const email = "extension-" + uuid() + "@example.test";
    await post("/api/auth", {action:"register",email,password}, 200, "");
    const r = await request("/api/auth", {action:"login",email,password}, "");
    assert.equal(r.status,200,JSON.stringify(r.body));
    const jar = r.response.headers.getSetCookie().map((c)=>c.split(";")[0]).join("; ");
    if(other) otherCookies=jar; else cookies=jar;
  }
});
after(async () => { await stack?.stop(); });

test("A1/A3 server-side command preparation is idempotent by source even with a new transaction ID", async () => {
  const f = await fixture(), source = uuid();
  const input = {id:uuid(),kind:"expense",accounting_date:"2026-10-15",description:"Costs",party_id:null,source_id:f.bank,destination_id:f.expense,amount:"25",currency:"THB",rate:"1",splits:[]};
  const first = await post(f.base+"/commands",{type:"guided",source_id:source,input,post:true});
  const second = await post(f.base+"/commands",{type:"guided",source_id:source,input:{...input,id:uuid()},post:true});
  assert.equal(second,first);
  await post(f.base+"/commands",{type:"guided",source_id:source,input:{...input,id:uuid(),amount:"26"},post:true},409);
  await post(f.base+"/commands",{type:"guided",input:{...input,id:uuid(),lines:[{book_amount:"0"}]},post:true},400);
  const rows = (await snapshot(f)).transactions.filter((t)=>t.description==="Costs");
  assert.equal(rows.length,1);
  const origin = (await stack.db.query("select s.module,o.source_id,o.transaction_id from accounting_sources s join accounting_operations o on o.source_id=s.id where s.id=$1",[source])).rows[0];
  assert.equal(origin.module,"bookkeeping"); assert.equal(origin.transaction_id,first);
});

test("A2/A4 real Auth/API/service/RPC payroll accrual and partial/full mobile-transfer settlement", async () => {
  const f = await fixture(), a = salary(f);
  const accrued = await post(f.base+"/payroll-accruals",a);
  assert.equal(await post(f.base+"/payroll-accruals",{...a,id:uuid()}),accrued);
  await post(f.base+"/payroll-accruals",{...a,id:uuid(),amount:"1"},409);
  const initial = await snapshot(f);
  assert.equal(initial.transactions.find((t)=>t.id===accrued).kind,"recognition");
  assert.equal(initial.lines.find((l)=>l.transaction_id===accrued && l.account_id===f.expense).book_amount,"20000.00000000");
  const firstRequest = {...payment(f,a),fee:{account_id:f.fee,funding_account_id:f.bank,amount:"100",rate:"1"}};
  const first = await post(f.base+"/payroll-payments",firstRequest);
  const p = await snapshot(f);
  const payableLines=p.lines.filter((l)=>l.account_id===f.payable);
  assert.equal(payableLines.reduce((sum,l)=>sum+Number(l.amount)*(l.side==="credit"?1:-1),0),1000000);
  assert.equal(p.lines.filter((l)=>l.account_id===f.expense).length,1);
  assert.equal(p.lines.find((l)=>l.transaction_id===first && l.account_id===f.fee).book_amount,"100.00000000");
  const evidence=(await stack.db.query("select transfer_evidence from accounting_operations where transaction_id=$1",[first])).rows[0].transfer_evidence[0];
  assert.equal(Number(evidence.effective_rate),125);
  assert.equal(evidence.provider_rate,"124.9");
  assert.equal(evidence.provider,"Bank app");
  const finalRequest=payment(f,a,"1000000","10000");
  const final=await post(f.base+"/payroll-payments",finalRequest);
  assert.equal(await post(f.base+"/payroll-payments",{...finalRequest,id:uuid()}),final); // Still succeeds after outstanding reaches zero.
  const done=await snapshot(f);
  assert.equal(done.lines.filter((l)=>l.account_id===f.payable).reduce((sum,l)=>sum+Number(l.amount)*(l.side==="credit"?1:-1),0),0);
  const provenance=await stack.db.query("select count(*)::int as n from accounting_operations where workspace_id=$1 and source_id=$2",[f.w,a.source_id]);
  assert.equal(provenance.rows[0].n,3);
  await post(f.base+"/reversals",{original:final,reversal:uuid(),on_date:"2026-11-02"});
});

test("A3 invalid inputs, owner/workspace isolation and forged source links fail at the real API", async () => {
  const f=await fixture(),a=salary(f);
  await post(f.base+"/payroll-accruals",{...a,period:"2026-13"},400);
  await post(f.base+"/payroll-accruals",{...a,book_amount:"1"},400);
  await post(f.base+"/payroll-accruals",a,401,"");
  await post(f.base+"/payroll-accruals",a,403,otherCookies);
  const badOrigin=await request(f.base+"/payroll-accruals",a,cookies,"https://forged.test");
  assert.equal(badOrigin.status,403);
  await post(f.base+"/payroll-accruals",a);
  const second=await fixture();
  await post(second.base+"/payroll-accruals",{...salary(second),source_id:a.source_id},403);
  const short=payment(f,a,"1990000","16000");
  await post(f.base+"/payroll-payments",short);
  await post(f.base+"/payroll-payments",payment(f,a,"10001","100"),400);
  const p=await snapshot(f);
  assert.equal(p.lines.filter((l)=>l.account_id===f.payable).reduce((sum,l)=>sum+Number(l.amount)*(l.side==="credit"?1:-1),0),10000);
});


test("A1/A5 built-in workflows persist 50 payment pairs and 99 categories, rejecting only actual posting overflow", async () => {
  const f = await fixture(), payable = uuid();
  await post(f.base + "/accounts", {id: payable, name: "THB payable boundary", type: "liability", role: "payable", currency_code: "THB", is_active: true});
  const bill = await post(f.base + "/commands", {type: "guided", post: true, input: {
    id: uuid(), kind: "bill", accounting_date: "2026-10-31", description: "Boundary bill", party_id: f.employee,
    source_id: payable, destination_id: f.expense, amount: "50", currency: "THB", rate: "1", splits: [],
  }});
  const initial = await snapshot(f);
  const recognized = initial.lines.find((line) => line.transaction_id === bill && line.account_id === payable);
  const obligation = initial.obligations.find((item) => item.recognition_line_id === recognized.id);
  const allocation = {obligation_id: obligation.id, amount: "1", funding_account_id: f.bank, funding_amount: "1", funding_rate: "1"};
  const paymentInput = {id: uuid(), accounting_date: "2026-11-01", description: "Fifty simple pairs", allocations: Array.from({length: 50}, () => ({...allocation})), fx_account_id: f.fx};
  const counts = async () => {
    const result = {};
    for (const table of ["accounting_sources", "accounting_operations", "transactions", "journal_lines", "obligations", "settlements"])
      result[table] = (await stack.db.query("select count(*)::int as n from " + table + " where workspace_id=$1", [f.w])).rows[0].n;
    return result;
  };
  const rejectWithoutWrites = async (body) => {
    const before = await counts();
    await post(f.base + "/commands", body, 400);
    assert.deepEqual(await counts(), before);
  };
  await rejectWithoutWrites({type: "payment", post: true, input: {...paymentInput, id: uuid(), allocations: [...paymentInput.allocations, allocation]}});
  await rejectWithoutWrites({type: "payment", post: true, input: {...paymentInput, id: uuid(), fee: {account_id: f.fee, funding_account_id: f.bank, amount: "1", rate: "1"}}});
  await rejectWithoutWrites({type: "payment", post: true, input: {...paymentInput, id: uuid(), allocations: paymentInput.allocations.map((a) => ({...a, funding_amount: "2"}))}});
  const source = uuid();
  const paid = await post(f.base + "/commands", {type: "payment", source_id: source, post: true, input: paymentInput});
  const paidSnapshot = await snapshot(f);
  const paymentLines = paidSnapshot.lines.filter((line) => line.transaction_id === paid);
  assert.equal(paymentLines.length, 100);
  const paymentLineIds = new Set(paymentLines.map((line) => line.id));
  const pairs = paidSnapshot.settlements.filter((pair) => paymentLineIds.has(pair.clearing_line_id));
  assert.equal(pairs.length, 50);
  assert.ok(pairs.every((pair) => pair.obligation_id === obligation.id && paymentLineIds.has(pair.funding_line_id)));
  assert.equal(paymentLines.filter((line) => line.account_id === payable).reduce((sum, line) => sum + Number(line.amount), 0), 50);
  assert.equal(paidSnapshot.lines.filter((line) => line.account_id === payable).reduce((sum, line) => sum + Number(line.amount) * (line.side === "credit" ? 1 : -1), 0), 0);
  assert.equal(await post(f.base + "/commands", {type: "payment", source_id: source, post: true, input: {...paymentInput, id: uuid()}}), paid);

  const split = {account_id: f.expense, amount: "1"};
  const guidedInput = {id: uuid(), kind: "expense", accounting_date: "2026-11-01", description: "Ninety-nine categories", party_id: null,
    source_id: f.bank, destination_id: "", amount: "99", currency: "THB", rate: "1", splits: Array.from({length: 99}, () => ({...split})), fx_account_id: f.fx};
  await rejectWithoutWrites({type: "guided", post: true, input: {...guidedInput, id: uuid(), splits: [...guidedInput.splits, split]}});
  await rejectWithoutWrites({type: "guided", post: true, input: {...guidedInput, id: uuid(), amount: "100"}});
  const expense = await post(f.base + "/commands", {type: "guided", post: true, input: guidedInput});
  const final = await snapshot(f);
  const splitLines = final.lines.filter((line) => line.transaction_id === expense);
  assert.equal(splitLines.length, 100);
  assert.equal(splitLines.filter((line) => line.account_id === f.expense && line.side === "debit" && Number(line.amount) === 1).length, 99);
  assert.equal(splitLines.find((line) => line.account_id === f.bank).amount, "99.00000000");
  assert.equal(splitLines.some((line) => line.account_id === f.fx), false);
});

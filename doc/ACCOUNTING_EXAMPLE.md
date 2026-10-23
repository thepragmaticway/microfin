# Worked accounting example: software outsourcing company

This document is the project's reference example for learning double-entry accounting, including startup spending, payroll in MMK and THB, and customer revenue in SGD. All transactions and exchange rates are fictional.

## Assumptions

- The company starts with zero balances, then receives USD 10,000 as an owner's equity contribution, not a loan.
- USD is the assumed functional currency for this exercise. Earlier dollar amounts in the example mean USD.
- Original transaction amounts and currencies are retained alongside their USD book values. Amounts in different currencies are not added without conversion.
- Exchange rates remain fixed throughout the exercise. There are no exchange gains, losses, or bank fees.
- The office lease lasts six months, has no purchase option, and uses the short-term lease expense election. The USD 1,000 rent covers office use already consumed in the current month.
- The USD 1,000 office deposit is refundable and recorded at its full amount for this exercise.
- Computers and desks are purchased outright, delivered, and available for use. They are recorded as equipment assets.
- Visa application services and developer transportation have already been provided and are treated as expenses. Transportation here means developer travel, not equipment delivery.
- Salaries relate to work already performed. Gross salaries are paid in full; payroll deductions, employer contributions, and taxes are excluded from this exercise.
- A bank converts USD and immediately remits MMK and THB salaries directly to employees. The company does not hold MMK or THB bank balances in this example.
- Customer work is fully earned and paid immediately into the SGD bank account; there is no customer receivable or advance payment.
- The final snapshot is before depreciation and closing entries. Payroll has been paid. There are no owner withdrawals or other transactions.

## Practice exchange rates

These are invented teaching rates, not market quotations.

| Original currency | USD per one currency unit | Conversion rule |
|---|---:|---|
| USD | 1.00 | USD amount stays unchanged |
| SGD | 0.75 | SGD amount × 0.75 |
| THB | 0.03 | THB amount × 0.03 |
| MMK | 0.00025 | MMK amount × 0.00025 |

## Accounting model

The company's position follows:

```text
Assets = Liabilities + Ending equity
```

Changes during the exercise follow:

```text
Ending equity = Starting equity + Contributions - Withdrawals + Revenue - Expenses

Assets + Expenses + Withdrawals
    = Liabilities + Starting equity + Contributions + Revenue
```

Starting equity is zero for this complete example. The USD 10,000 investment is a contribution during the exercise; it must not also be counted as starting equity.

| Account type | Increase | Decrease | Normal balance |
|---|---|---|---|
| Asset | Debit | Credit | Debit |
| Liability | Credit | Debit | Credit |
| Equity / owner contribution | Credit | Debit | Credit |
| Revenue | Credit | Debit | Credit |
| Expense | Debit | Credit | Debit |
| Owner withdrawal / distribution | Debit | Credit | Debit |

Every account can receive debit and credit entries. A trial balance shows each account's net balance on its actual debit or credit side. Normal balances are conventions, not a prohibition on opposite balances. Each journal entry must have equal total debits and credits in USD.

## Accounts used

The identifiers below are local reference identifiers, not prescribed account numbers.

| Account ID | Account | Type | Why it exists |
|---|---|---|---|
| A-USD | USD bank | Asset | USD cash controlled by the company |
| A-SGD | SGD bank | Asset | SGD cash controlled by the company, also measured in USD |
| A-DEPOSIT | Refundable office deposit | Asset | Right to recover the deposit under its conditions |
| A-COMPUTERS | Computers | Asset | Equipment controlled and available for business use |
| A-DESKS | Desks | Asset | Furniture controlled and available for business use |
| L-PAY-MMK | Payroll payable — MMK team | Liability | Earned salaries owed in MMK until settlement |
| L-PAY-THB | Payroll payable — THB team | Liability | Earned salaries owed in THB until settlement |
| E-CAPITAL | Owner's capital | Equity | Owner contribution without a loan repayment obligation |
| R-SERVICES | Software service revenue | Revenue | Earned customer fees that increase profit |
| X-RENT | Rent expense | Expense | Current month's office use consumed |
| X-VISA | Visa processing expense | Expense | Completed application services consumed |
| X-TRAVEL | Travel expense | Expense | Completed developer transportation consumed |
| X-PAY-MMK | Salary expense — MMK team | Expense | Cost of the MMK team's work performed |
| X-PAY-THB | Salary expense — THB team | Expense | Cost of the THB team's work performed |

Revenue and expenses are tracked separately to explain profit or loss, whose effect is included in equity. An expense is not an asset just because both normally have debit balances.

## Transaction sequence and journal entries

All debit and credit amounts below are USD book values. Rows sharing a transaction ID form one journal entry.

| Transaction | Event / original amount | Account | Debit USD | Credit USD |
|---|---|---|---:|---:|
| T01 | Owner contributes USD 10,000 | A-USD | 10,000 | |
| T01 | | E-CAPITAL | | 10,000 |
| T02 | Pay refundable deposit: USD 1,000 | A-DEPOSIT | 1,000 | |
| T02 | | A-USD | | 1,000 |
| T03 | Pay for current month's office use: USD 1,000 | X-RENT | 1,000 | |
| T03 | | A-USD | | 1,000 |
| T04 | Buy computers: USD 3,000 | A-COMPUTERS | 3,000 | |
| T04 | | A-USD | | 3,000 |
| T05 | Buy desks: USD 500 | A-DESKS | 500 | |
| T05 | | A-USD | | 500 |
| T06 | Pay completed visa application services: USD 500 | X-VISA | 500 | |
| T06 | | A-USD | | 500 |
| T07 | Pay completed developer travel: USD 200 | X-TRAVEL | 200 | |
| T07 | | A-USD | | 200 |
| T08 | Recognize earned salaries: MMK 2,000,000 = USD 500 | X-PAY-MMK | 500 | |
| T08 | Recognize earned salaries: THB 30,000 = USD 900 | X-PAY-THB | 900 | |
| T08 | MMK salaries owed | L-PAY-MMK | | 500 |
| T08 | THB salaries owed | L-PAY-THB | | 900 |
| T09 | Settle MMK 2,000,000 of salaries | L-PAY-MMK | 500 | |
| T09 | Settle THB 30,000 of salaries | L-PAY-THB | 900 | |
| T09 | USD bank funds direct currency conversion and payment | A-USD | | 1,400 |
| T10 | Receive earned customer fee: SGD 4,000 = USD 3,000 | A-SGD | 3,000 | |
| T10 | | R-SERVICES | | 3,000 |
| **Total journal movements** | | | **22,000** | **22,000** |

### Why payroll uses two stages

- **Plan:** a salary budget alone does not create the salary expense or payable in this example.
- **Earn:** T08 records work already performed, increasing expense and the obligation to employees.
- **Pay:** T09 settles that obligation and reduces USD cash. It does not create another expense.

If recognition and payment happen together, a combined entry can debit salary expense and credit cash directly. This example retains both stages to make the obligation visible.

## Current trial balance

This is the unadjusted, pre-closing snapshot after T10. Zero-balance payroll accounts are included to show that settlement is complete.

| Account | Debit USD | Credit USD |
|---|---:|---:|
| USD bank | 2,400 | |
| SGD bank — holds SGD 4,000 | 3,000 | |
| Refundable office deposit | 1,000 | |
| Computers | 3,000 | |
| Desks | 500 | |
| Rent expense | 1,000 | |
| Visa processing expense | 500 | |
| Travel expense | 200 | |
| Salary expense — MMK team | 500 | |
| Salary expense — THB team | 900 | |
| Payroll payable — MMK team | 0 | 0 |
| Payroll payable — THB team | 0 | 0 |
| Owner's capital | | 10,000 |
| Software service revenue | | 3,000 |
| **Total** | **13,000** | **13,000** |

Zero in both columns means the account has no remaining balance; it does not indicate two separate balances.

## Reconciliation and expected results

### Cash

```text
Startup cash payments = 1,000 + 1,000 + 3,000 + 500 + 500 + 200 = 6,200
USD bank = 10,000 - 6,200 - 1,400 = 2,400 USD
SGD bank = 4,000 SGD = 3,000 USD
Total cash book value = 2,400 + 3,000 = 5,400 USD
```

There are no remaining MMK or THB bank balances. MMK 2,000,000 and THB 30,000 were remitted to employees, and both payroll payables are zero.

### Profit and equity

```text
Revenue = 3,000
Expenses = 1,000 + 500 + 200 + 500 + 900 = 3,100
Profit / (loss) = 3,000 - 3,100 = -100

Ending equity = 0 + 10,000 - 0 + 3,000 - 3,100 = 9,900
```

The owner's capital account remains USD 10,000. Before closing, the USD 100 loss is represented by the separate revenue and expense balances. Closing transfers that net result into the appropriate accumulated-profit/loss equity account without changing total equity.

### Accounting equations

```text
Assets = 2,400 + 3,000 + 1,000 + 3,000 + 500 = 9,900
Liabilities = 0
Ending equity = 9,900

Compact:
9,900 = 0 + 9,900

Expanded:
Assets + Expenses + Withdrawals
    = Liabilities + Starting equity + Contributions + Revenue

9,900 + 3,100 + 0 = 0 + 0 + 10,000 + 3,000
13,000 = 13,000
```

The journal movement totals of USD 22,000 differ from the trial balance totals of USD 13,000 because journal totals count all postings, whereas the trial balance contains net account balances.

## Reference principles

- [IAS 19 — Employee Benefits](https://www.ifrs.org/issued-standards/list-of-standards/ias-19-employee-benefits/): recognition of employee service costs and unpaid employee benefit obligations.
- [IAS 21 — The Effects of Changes in Foreign Exchange Rates](https://www.ifrs.org/issued-standards/list-of-standards/ias-21-the-effects-of-changes-in-foreign-exchange-rates/): functional currency and foreign-currency accounting. The fixed rates here intentionally remove exchange-rate changes from the exercise.
- [IFRS 16 — Leases](https://www.ifrs.org/content/dam/ifrs/publications/pdf-standards/english/2022/issued/part-a/ifrs-16-leases.pdf?bypass=on): short-term lease recognition exemption used in the office example.

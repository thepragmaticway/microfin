import { createServer } from "node:net";

// Minimal disposable SMTP sink. It accepts mail only into this test process;
// delivery assertions observe GoTrue's actual SMTP output, not mocked Auth calls.
export async function testMailbox() {
  const messages = [];
  const sockets = new Set();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    let buffer = "",
      body = "",
      inData = false,
      recipients = [];
    socket.setEncoding("utf8");
    socket.write("220 microfin-test SMTP ready\r\n");
    socket.on("data", (chunk) => {
      buffer += chunk;
      while (buffer.includes("\r\n")) {
        const end = buffer.indexOf("\r\n"),
          line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (inData) {
          if (line === ".") {
            messages.push({ recipients: [...recipients], raw: body });
            inData = false;
            body = "";
            recipients = [];
            socket.write("250 Message captured\r\n");
          } else
            body += (line.startsWith("..") ? line.slice(1) : line) + "\r\n";
          continue;
        }
        if (/^(EHLO|HELO) /i.test(line)) socket.write("250 microfin-test\r\n");
        else if (/^MAIL FROM:/i.test(line)) {
          recipients = [];
          socket.write("250 Sender accepted\r\n");
        } else if (/^RCPT TO:/i.test(line)) {
          const recipient = line.match(/<([^>]+)>/);
          if (recipient) recipients.push(recipient[1]);
          socket.write("250 Recipient accepted\r\n");
        } else if (/^DATA$/i.test(line)) {
          inData = true;
          socket.write("354 End data with <CRLF>.<CRLF>\r\n");
        } else if (/^QUIT$/i.test(line)) {
          socket.end("221 Bye\r\n");
        } else if (/^(RSET|NOOP)/i.test(line)) {
          body = "";
          recipients = [];
          socket.write("250 OK\r\n");
        } else socket.write("502 Command not supported\r\n");
      }
    });
    socket.on("error", () => {});
  });
  await new Promise((resolve) => server.listen(0, "0.0.0.0", resolve));
  return {
    port: server.address().port,
    messages,
    stop: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

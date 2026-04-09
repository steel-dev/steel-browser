## 2026-04-09 - Node.js HTTP stream leak and timeout missing
**Vulnerability:** SSRF-like resource exhaustion and stream leaking via missing timeout and unconsumed non-200 responses in Node.js http.get.
**Learning:** Native Node.js HTTP clients (http.get/https.get) do not time out by default and can hold resources indefinitely. Also, if a response stream is not consumed (e.g. on a non-200 error), the socket will remain open, leading to resource leaks.
**Prevention:** Always specify a `timeout` and handle the `timeout` event. Always call `response.resume()` if discarding the response body.

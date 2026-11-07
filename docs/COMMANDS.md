# Commands API

The commands API drives the session's browser with high-level actions. It is built for AI agents: take a snapshot of the page, pick an element by its ref, and act on it. The engine runs inside steel-browser next to Chrome, so one HTTP request can run several commands and return the new page state.

The API is experimental and off by default. Start the server with `ENABLE_COMMANDS_API=true` to turn it on. When it is off, the routes below do not exist and the server behaves as if the engine were not there.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/sessions/{sessionId}/commands` | Run commands in the session |
| `GET` | `/v1/sessions/{sessionId}/commands/executions/{executionId}` | Wait for an execution and return it |
| `POST` | `/v1/sessions/{sessionId}/commands/executions/{executionId}/cancel` | Stop an execution |
| `POST` | `/v1/sessions/{sessionId}/commands/dialogs/{dialogId}/answer` | Answer an open dialog |
| `GET` | `/v1/sessions/{sessionId}/commands/schema` | JSON Schema of the request body (`version: 2`) |

`sessionId` is the session this server is running. `POST /v1/sessions` returns it. A request for another session gets `410 session_ended`. The session also ends when the browser crashes or when the server ends it for a security reason, such as a `file://` request. The server then starts a fresh browser with default settings, without the session's proxy or extensions, so create a new session to go on. When a release starts, commands get `410` right away. The routes are also described in the OpenAPI document at `/documentation`.

## Example

```bash
curl -X POST http://localhost:3000/v1/sessions/$SESSION_ID/commands \
  -H "Content-Type: application/json" \
  -d '{
    "commands": [
      { "command": "navigate", "url": "https://example.com" },
      { "command": "snapshot", "interactive": true }
    ]
  }'
```

```json
{
  "next": "op_3cvyhx9ub0",
  "page": { "tab": "t1", "url": "https://example.com/", "title": "Example Domain" },
  "execution": { "id": "x-1", "state": "completed", "effect": "applied", "replayed": false, "ran": 2 },
  "results": [
    { "command": "navigate", "ok": true, "effect": "applied", "url": "https://example.com/" },
    { "command": "snapshot", "ok": true, "effect": "none", "snapshotId": "s-1", "snapshot": "- link \"Learn more\" [ref=e1]" }
  ]
}
```

Then act on the ref:

```json
{ "after": "op_3cvyhx9ub0", "commands": [{ "command": "click", "target": "e1" }] }
```

## Request

| Field | Meaning |
|---|---|
| `commands` | One command, or an array of up to 50. They run in order and stop at the first failure. Commands that already ran are not undone. |
| `after` | The `next` value from your last response. The response sets `epochChanged: true` if the session changed in between. A retried request with the same `after` and commands runs only once, even if its `Idempotency-Key` changed. |
| `observe` | `{ "mode": "snapshot" }` returns a snapshot after the commands. `"diff"` returns a unified diff against the last snapshot of the tab, or against `base` (a snapshot id). It takes the snapshot options below, and `tab` when several tabs are open and the commands did not pick one. |

Fields that are not listed here, or that a command does not take, are refused with `400 invalid_request`. A typo in `after` would otherwise turn off duplicate protection without notice. So are arguments that do not fit together, such as a `wait` with two conditions, `get attr` without `attribute`, a key name the engine does not know, or a ref with `frame`. The whole request is refused before any command runs.

Send a random `Idempotency-Key` header to make retries safe. A request with a key that was already used returns the stored result (`replayed: true`) for at least an hour, even after its `after` expires. The same key with different commands gets `422 key_conflict`. Large result bodies, such as snapshot text and screenshot data, are kept for 10 minutes. A replay after that returns the rest of the result with `bodyExpired: true`. Starting a session again, even with the same id, starts with no stored results. Ids keep counting across sessions while the server runs, so refs, tab ids, execution ids, and dialog ids from an earlier session never point at anything new. The first tab of a session is not always `t1`.

## Response

| Field | Meaning |
|---|---|
| `next` | Send it as `after` in your next request. Valid for an hour. |
| `epochChanged` | Set when the execution ran with `after`. `true` when, since that `after`, another execution or a dialog answer changed the page, a quick action ran on the session's tabs, or the browser restarted. Input from a CDP client or the live view does not count. |
| `page` | The tab the execution used, with its URL and title. |
| `execution` | `id`, `state`, `effect`, `replayed`, and `ran` (commands started). `error` says why an execution ended early. |
| `results` | One entry per command that ran: `command`, `ok`, `effect`, the fields of that command, and `error` (`code`, `message`, `reason`) when it failed. |
| `observe` | `snapshotId` with `snapshot`, or `diff`. A diff without a usable base returns the full snapshot with `full: true`. If the snapshot fails, `observe` is `{ "error": { ... } }` and the commands' results stay as they are. |
| `dialog` | A dialog that is open on the tab and waits for an answer. |

`effect` tells what happened to the page: `none` (nothing changed), `applied` (the page changed), or `unknown` (it may have changed, for example after a timeout during input). When an execution is cancelled or runs out of time, the running command stops before its next input, so `effect: none` means nothing changed. A click or drag that already pressed the mouse button still lets it go, and its effect is `unknown`. The page has 10 seconds to take each input. If it takes longer, the command fails with `timeout`, and a pressed button or key is still let go.

Executions run one at a time per session. The response waits up to 20 seconds. A longer execution keeps running and the response shows `state: "running"`. Wait for it with `GET /v1/sessions/{sessionId}/commands/executions/x-1`, which also waits up to 20 seconds, or stop it with `POST /v1/sessions/{sessionId}/commands/executions/x-1/cancel`. Both return the execution in the same shape as a run, and both work while other executions run or wait. An execution stops after 60 seconds. `navigate` waits up to 15 seconds for the page to load. Up to 16 executions can wait in the queue.

Cancelling stops a page load in progress and keeps the tab. If a command still does not stop 2 seconds after a cancel, or 15 seconds after a timeout, the engine stops the page's scripts, including those in frames. If the command had already sent input to the page, the engine then closes the tab, and as a last resort ends the session. A command that has not sent input yet, such as a snapshot, is left behind instead, and the tab stays open.

Execution states are `queued`, `running`, `completed`, `failed`, `cancelled`, `timeout`, and `expired` (it could not start in time).

When an input command (such as `click`, `press`, `fill`, or `select`) starts a navigation in its tab, the command waits until the new page's DOM is loaded, for up to 15 seconds. If the page is still loading after that, the result has `loading: true`, and `{ "command": "wait", "load": "load" }` waits for it.

## Targets

- A ref from a snapshot: `"e12"`. `"@e12"` and `"ref=e12"` work too.
- A CSS selector: `"#submit"`.
- A locator object with exactly one of `role` (with an optional `name`), `text`, `label`, `placeholder`, `alt`, `title`, `testid`, or `css`. Text matching is a case-insensitive substring match unless `exact` is `true`. `testid` always matches exactly. `nth` picks a match, and negative values count from the end. Without `nth`, a locator must find one element. When it finds several and exactly one of them is visible, that one is used. Otherwise the command fails with `invalid_argument` (`ambiguous`). Values must contain more than spaces, and `name` is accepted only with `role`.

Tabs are the pages of the session's main browser context. Pages that quick actions open in a separate context with `proxyUrl` are not tabs, and neither are pages in browser contexts that a connected CDP client created. When a tab's page crashes, commands on it fail at once with `tab_crashed`, including a command that was running. `navigate` or `reload` on that tab starts it again. A ref already knows its tab and frame. Commands without a ref take `tab` (an id from `tab list`, such as `t2`), and locators inside an iframe take `frame`. `frame` names the iframe the same ways as a target: a ref, a CSS selector, or a locator. A CSS selector or a locator is looked up in the top page, follows the same rules as a target, and must find an `iframe` or `frame` element. When it finds another element, the command fails with `frame_not_found` (`not_frame`). When the frame is not in the page yet, `wait`, `is`, `get count`, and `find` treat it like an element that is not there, so a `wait` keeps waiting for a frame that loads late. Other commands fail with `frame_not_found` (`missing`). For an iframe inside another iframe, pass a list from the outside in, such as `["#outer", { "title": "Payment" }]`. A ref already names its frame, so pass it alone, not in a list. `expect: { "role": ..., "name": ... }` makes a command fail when the element is not what you expect: with `stale_ref` (`expect_mismatch`) for a ref, and with `element_not_found` (`expect_mismatch`) for a locator.

A ref names one node. Taking another snapshot of the same document keeps the ref. When the node leaves the page, the command fails with `stale_ref` (`detached`). A hidden node keeps its ref, so `is visible` returns `false` and a `wait` for `detached` goes on waiting. When a list reuses the node for other content, it fails with `stale_ref` (`content_changed`). This also holds when the ref is the item itself: an element without a name, such as a clickable card, is checked against its own text. Text inside editable fields and other controls that show a value, such as date and number inputs, does not count, so filling a field keeps the refs around it, including the ref of a table cell or list item that contains the field. Clicks check this again after scrolling and after the mouse moves onto the element, right before they press, so a list that reuses the node while scrolling does not get the wrong item clicked. Cards that repeat in a list count as items even when their text is long. A snapshot refreshes this check only for the refs it shows, so a snapshot with a small `depth` does not hide a change from a ref you took earlier. Take a new snapshot in both cases.

## Snapshots

An interactive snapshot looks like this:

```
- heading "Account" [level=1, ref=e1]
- textbox "Name" [ref=e2]: Jun
- checkbox "Remember me" [checked=false, ref=e3]
- button "Save" [ref=e4]
- generic "Open card" [ref=e5] clickable [cursor:pointer]
```

Each line has the accessibility role, the name, states (`level`, `checked`, `expanded`, `selected`, `disabled`, `required`), the ref, and the value after `: `. Elements that look clickable but have no interactive role get a ref and a hint such as `clickable [cursor:pointer]`. Iframes are expanded under their `Iframe` line. A frame that does not answer within 5 seconds, for example because its scripts are busy, is left out and shows `(did not answer)`.

| Option | Effect |
|---|---|
| `interactive` | Only lines with refs |
| `compact` | Only lines with refs or values, and their ancestors |
| `depth` | Lines up to this depth |

Password fields, and fields and editable regions that the browser hides with `-webkit-text-security`, show `••••••••`. This includes fields inside closed shadow roots. Their values are also hidden wherever else they show up: in the names of other elements (such as a button with a PIN field inside, or a field labelled by text that contains one), in `find` results, in error messages, and in `get text` and `get html`, also for an element inside such an editable region. Outside the names of the elements that contain them, only values of four or more characters are hidden, so short values do not blank out unrelated text. The engine hides at most 100,000 characters of such values per page; a page with more shows the rest. In error messages, the name of the element in question hides the values of fields inside it at any length. Line breaks inside values show as `\n`.

## Commands

| Command | Arguments | Notes |
|---|---|---|
| `navigate` | `url`, `tab` | Only `http`, `https`, and `about:blank`. A URL without a scheme gets `https://`. |
| `back`, `forward`, `reload` | `tab` | `navigated: false` when there is no history entry. A history step that only moves a frame does not wait for the page to load. |
| `snapshot` | `tab`, `interactive`, `compact`, `depth` | Returns `snapshotId` and `snapshot`. |
| `find` | `target`, `tab`, `frame` | Returns `count` and refs for up to 50 matches. `target` is a CSS selector or a locator, not a ref. With `nth`, it returns that one match. |
| `click`, `dblclick`, `hover` | `target` | Uses the mouse. See [Clicking](#clicking). A disabled element fails with `not_actionable` (`disabled`). |
| `focus` | `target` | |
| `type` | `target`, `text`, `clear`, `delay` | Types the text one key press at a time, so pages see `keydown` and `keyup` for each character. It types after the current content, or at the cursor when the field already has focus. Line breaks (`\n` or `\r\n`) and tabs are sent as Enter and Tab. `clear` replaces the current content. Read-only and disabled fields fail with `not_actionable` (`read_only`, `disabled`), and so do inputs that take no text, such as checkboxes (`not_editable`). Date and time fields take the value as `fill` does. Other focusable elements, such as custom widgets that read keys, get the same key presses. If a dialog opens partway, typing stops and the command fails with `dialog_pending` (`during_type`), saying how many characters it typed. |
| `fill` | `target`, `value` | Selects the content and replaces it in one step, without key presses. Date and time inputs take values like `2025-01-31`. |
| `press` | `key`, `target` | Key names follow the US layout (`Enter`, `Tab`, `ArrowDown`, `F5`) and combinations such as `Control+a`. |
| `keydown`, `keyup` | `key`, `tab` | Holds a key down or lets it go, for example `Shift` while you click. A key stays down until its `keyup`. Held modifier keys (`Shift`, `Control`, `Alt`, `Meta`) apply to later mouse and key input on the tab. Takes one key, not a combination such as `Control+a`. |
| `mouse` | `action` (`move`, `down`, `up`, `click`, `wheel`), `x`, `y`, `button`, `clicks`, `deltaX`, `deltaY`, `tab` | Mouse input at a point, for pages without useful elements such as a canvas or a map. `x` and `y` are CSS pixels of the visible part of the page, like `get box`. `down` and `up` use the last point the mouse moved to when you leave them out. A button held with `down` stays down until `up`, and `move` drags with it. `button` is `left` (default), `right`, or `middle`. `clicks` (1 to 3) makes `click` a double or triple click. `wheel` scrolls by `deltaX` and `deltaY` at the point. |
| `select` | `target`, `values` | Matches options by value, then label, then label ignoring case. |
| `check`, `uncheck` | `target` | Checkboxes, radio buttons, switches, and toggle buttons. A disabled control fails with `not_actionable` (`disabled`). A target that is not one of these counts when it is a label, or when it holds a single checkbox or radio button as a child or grandchild. Clicks that checkbox or radio button, or the target itself when the control cannot be clicked and the target is a label or holds no other controls, such as buttons or links. Then it waits up to 1.5 seconds for the state to change. Presses Space instead only when something covers the control or it has no visible box. If the control changes when the mouse moves onto it, the command stops instead. If the page draws the control again when it is clicked, a locator target finds the new control in the same tab and reads its state. A ref target fails with `stale_ref` (`detached`, effect `applied`); take a new snapshot to see the state. |
| `scroll` | `direction`, `amount`, `target` | Scrolls the page or an element. Returns `x`, `y`, and `moved`. When nothing moved, `moved` is false and `effect` is `none`; pages that scroll an inner container need that container as `target`. |
| `upload` | `target`, `files` | File names from the session's files. Upload them first with `POST /v1/sessions/{sessionId}/files`. A disabled file input fails with `not_actionable` (`disabled`). |
| `drag` | `source`, `target` | Drags with the mouse. HTML5 drag and drop works. |
| `get` | `what`, `target`, `attribute` | `text`, `html`, `markdown`, `value`, `attr`, `title`, `url`, `count`, `box`, or `locator`. `text` is the text a person can see. `box` is in CSS pixels of the visible part of the page, also for elements inside frames. `markdown` is the page's main content as Markdown, the same as `/v1/scrape` with the `markdown` format. With `target`, it is all of that element. Images in `data:` URLs are left out. `locator` lists ways to find the target again in a later session, best first. Each item has `target` and, for an element inside an iframe, `frame`, so you can copy an item into a command. Every item finds exactly this element on the current page. Only a `role` locator falls back to `nth`, and an iframe falls back to its tag or its role with `nth`. `role` uses the names that snapshots show, such as `iframe`, so the items are meant for this engine. An iframe's `src` is matched only up to its query, because the query often changes between sessions. Ids that look generated and values that contain a secret are left out. An empty list means the engine found no such way. |
| `is` | `what`, `target` | `visible`, `enabled`, or `checked`. For `visible`, a locator that matches several elements is visible when any of them is. |
| `wait` | one of `target` (with `state`), `text`, `url`, `load`, `ms`, `download`; `timeout` | `url` takes `*` patterns. `load` is `load`, `domcontentloaded`, or `networkidle`, and waits for a navigation in progress first. `networkidle` first waits for the `load` event, then for a quiet network. It also counts requests that started before the wait. `text` also looks inside open shadow roots. The default timeout is 10 seconds and the most is 50 seconds. `ms` can be at most 30000. A locator that matches several elements is visible when any of them is, and hidden when none is. A wait keeps watching the tab it started on, even if another tab opens, and fails with `tab_not_found` if that tab closes. With `ms`, that is the tab you pass, or the only open tab. `download: true` waits for a download to finish and returns `file` and `bytes`. Each such wait returns the next download that no earlier wait returned, also one that already finished, so you can click and wait in separate requests. Get the file with `GET /v1/sessions/{sessionId}/files/{file}`. A download that does not finish fails with `download_failed`. |
| `screenshot` | `target`, `fullPage`, `format`, `quality` | Returns base64 `data`. With `target`, it scrolls the element into view first; when that scrolls the page, `effect` is `applied`. |
| `pdf` | `tab`, `landscape`, `printBackground` | Returns base64 `data`. Needs headless Chrome. |
| `eval` | `script`, `timeout`, `tab` | Runs JavaScript in the page and returns `value`, the result as JSON. It waits for a promise to settle. The default timeout is 10 seconds and the most is 50 seconds. A script that throws fails with `script_error`. A result of more than 100,000 characters of JSON fails with `invalid_argument` (`too_large`). Secret values in the result are hidden, as elsewhere, but this only guards against accidents: a script can read and change anything on the page. |
| `tab` | `action` (`list`, `new`, `close`), `tab`, `url` | The last tab cannot be closed. |

## Clicking

Clicks, hovers, and drags scroll the element into view first. If that scroll moved the page and the command then fails, its `effect` is still `applied`. If the execution has already ended, for example by timing out, they stop before scrolling. The click point is the center of the largest visible part of the element, so a link that wraps over two lines is clicked on its text. If something else is on top at that point, for example because a scrolling container clips the element, the engine tries other points in the visible part and uses the first one where the element is on top. Before clicking, the engine checks which element is at that point:

- The element itself, or something inside it: the click goes ahead, unless that something is a button, link, or field of its own. Then the engine tries other points, so clicking a dialog does not press the button in its middle. A label may be clicked on its own field.
- A label that belongs to the element: the click goes ahead.
- An ancestor of the element: the click goes ahead when nothing between them is a button, link, or input of its own, or when the element has `pointer-events: none`.
- Anything else: the command fails with `not_actionable` (`covered`) and names the covering element, such as `dialog "Cookie settings" (<div id="consent">)`.

For an element inside a cross-origin iframe, the engine also checks each parent page at the click point, so an overlay in the parent page counts as covering. This also works when the iframe is scaled or rotated with CSS.

The engine checks the point once more after the mouse moves onto the element and before it presses the button. So a menu that opens on hover and lies on top of the element also counts as covering. If hovering takes the element off the page, for example by navigating, the click stops with `stale_ref` (`detached`), and if the point cannot be checked again it stops with `not_actionable` (`unverified`). These failures have `effect: applied`, because the mouse already moved and the page may have reacted to it.

An element outside the visible part of the page fails with `offscreen`, and an element without a box fails with `no_box`.

## Dialogs

- The engine never answers a dialog on its own. This holds for every type: `alert`, `confirm`, `prompt`, and `beforeunload`.
- An open dialog shows in the response's `dialog`. Answer with `POST /v1/sessions/{sessionId}/commands/dialogs/d-1/answer` and `{ "action": "accept", "text": "..." }`, or `"dismiss"`. `text` answers a prompt. The response is `{ "answered": { ... }, "next": "op_..." }`: the dialog with its answer, and a `next` to send as `after`, so your own answer does not count as a change. The answer runs right away, outside the queue. Until then, commands on that tab fail with `dialog_pending`. Another client, such as a CDP client, can answer it too. If it answers first, the answer returns `dialog_not_pending`.
- If a dialog opens when the mouse moves onto the element, before the click, the command fails with `dialog_pending` (reason `before_click`). Answer the dialog and click again.
- If a dialog stops a command partway, for example a focus handler that opens a confirm, the command fails with `dialog_pending` and does not go on after you answer the dialog. Send it again if you still need it.
- A dialog that opens during a timed `wait` or during `observe` also stops the execution, and the response shows it in `dialog`. A timed `wait` watches the tab you pass, or the only open tab.
- If a dialog opens while a mouse button or key is down, also one held with `mouse` `down` or `keydown`, the engine lets it go once the dialog closes. A click still completes. A Space press on a button can lose its click, because the dialog takes focus from the page.
- When a tab closes, its open dialog closes with it. Answering that dialog afterwards returns `dialog_not_pending`.
- A dialog that opened before the session started, such as one left open by an earlier session, shows in `dialog`. Commands on its tab fail with `dialog_pending` until you answer it.
- Dialogs that a new tab shows while it loads, such as a popup that calls `alert()` right away, follow the same rules.

## Quick actions

`/v1/scrape`, `/v1/screenshot`, `/v1/pdf`, `/v1/search`, `/v1/sessions/scrape`, `/v1/sessions/screenshot`, and `/v1/sessions/pdf` use the same tabs, so they take turns with commands. They return `409` while commands are running or waiting to run. A commands request that arrives while one of them is still running waits until it finishes. A quick action counts as a change, so the next request with `after` gets `epochChanged: true`. Pass `proxyUrl` to run them in a separate browser context.

## Errors

Request errors have no execution. The body is `{ "error": { "code": ..., "message": ... } }`.

| Status | Codes |
|---|---|
| 400 | `invalid_request` |
| 410 | `session_ended` |
| 422 | `key_conflict`, `invalid_operation_token`, `unknown_execution`, `dialog_not_pending` |
| 429 | `queue_full`, `expired`, `records_full` |
| 500 | `internal_error` |

`invalid_operation_token` means the engine no longer knows your `after`, for example because it is older than an hour or the session holds too many records. The response carries a fresh `next`. If you sent the same commands before, check the page first, because they may have run.

An unexpected error inside the engine returns `500` with `{ "error": { "code": "internal_error", ... } }` and no execution. The commands may have run, so the response carries `x-should-retry: false` when the request had neither an `Idempotency-Key` nor `after`, and `x-should-retry: true` otherwise. Steel's SDKs follow this header. A dialog answer whose dialog does not close also returns this, with `x-should-retry: true` and the dialog that is still open in `dialog`.

Command errors appear in `results[i].error`. The codes are `stale_ref`, `not_actionable`, `dialog_pending`, `element_not_found`, `invalid_argument`, `tab_not_found`, `tab_crashed`, `frame_not_found`, `tab_required`, `forbidden_url`, `forbidden_file`, `navigation_failed`, `download_failed`, `script_error`, `timeout`, `cancelled`, `session_ended`, `browser_restarted`, `unknown_command`, and `internal_error`. `reason` adds detail, for example `covered`, `offscreen`, `no_box`, `before_click`, `disabled`, `ambiguous`, `not_editable`, `read_only`, `not_focusable`, `not_checkable`, `disabled_option`, `detached`, `content_changed`, `unverified`, `missing`, or `not_frame`.

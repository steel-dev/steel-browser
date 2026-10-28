import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer, { ProtocolError, type Browser, type Page } from "puppeteer-core";
import { CdpCDPSession } from "puppeteer-core/internal/cdp/CdpSession.js";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  onTestFinished,
  test,
  vi,
} from "vitest";
import {
  CommandEngine,
  type EngineHost,
  type EngineOptions,
  type EngineResponse,
} from "./engine.js";
import { PREPARE_EDIT } from "./forms.js";
import { Tab } from "./tabs.js";

const chrome = process.env.CHROME_EXECUTABLE_PATH;

const SESSION = "s1";

interface Result {
  ok: boolean;
  effect: string;
  error?: { code: string; message: string; reason?: string };
  [field: string]: unknown;
}

interface Envelope {
  next?: string;
  epoch: number;
  epochChanged?: boolean;
  page: { tab: string; url: string; title: string } | null;
  execution: {
    id: string;
    state: string;
    effect: string;
    replayed: boolean;
    ran: number;
    error?: { code: string };
  };
  results: Result[];
  observe?: {
    snapshotId?: string;
    snapshot?: string;
    diff?: string;
    base?: string;
    full?: boolean;
    error?: { code: string };
  };
  dialog?: { id: string; tab: string; type: string; message: string };
  dialogs?: Array<{ id: string; type: string; accepted: boolean; by: string }>;
  answered?: { id: string; accepted: boolean; by: string };
  bodyExpired?: boolean;
  error?: { code: string; message: string };
}

const fixtures: Record<string, (other: string) => string> = {
  "/basic": () => `<!doctype html><title>Basic</title>
    <h1>Account</h1>
    <label>Name <input id="name"></label>
    <button onclick="document.title = 'saved'">Save</button>
    <a href="/next">Next page</a>`,
  "/counter": () => `<!doctype html><title>Counter</title>
    <button onclick="window.count = (window.count || 0) + 1">Add</button>`,
  "/hold": () => `<!doctype html><title>Hold</title>
    <button onmousedown="busy(this)" onclick="window.count = (window.count || 0) + 1" ondblclick="window.doubled = true">Add</button>
    <p onmousedown="busy(this)">Handle</p>
    <p>Target</p>
    <input aria-label="Keys" onkeydown="busy(this)" onkeyup="window.keyUp = true">
    <script>
      function busy(element) {
        if (element.busied) {
          return;
        }
        element.busied = true;
        const end = Date.now() + 2000;
        while (Date.now() < end) {}
      }
      addEventListener("mousemove", (event) => {
        if (event.buttons) {
          window.dragged = true;
        }
      });
      addEventListener("mouseup", (event) => {
        window.released = event.target.textContent;
      });
    </script>`,
  "/edit": () => `<!doctype html><title>Edit</title>
    <form onsubmit="event.preventDefault(); document.title = ['saved', this.person.value, document.getElementById('notes').textContent].join(' ')">
      <label>Name <input name="person" value="old"></label>
      <div id="notes" contenteditable aria-label="Notes">first draft</div>
      <button>Save</button>
    </form>
    <ul>
      <li><input aria-label="Task" value="Buy milk"> <button onclick="document.title = 'kept ' + this.previousElementSibling.value">Keep</button></li>
    </ul>`,
  "/hover-cover": () => `<!doctype html><title>Hover cover</title>
    <style>
      button { position: absolute; left: 0; top: 0; width: 200px; height: 60px }
      #menu { display: none }
      #save:hover + #menu, #menu:hover { display: block }
    </style>
    <button id="save" onclick="document.title = 'saved'">Save</button>
    <button id="menu" onclick="document.title = 'deleted'">Delete</button>`,
  "/confirm-load": () => `<!doctype html><title>Before</title><p>start</p>
    <script>confirm("Continue?")</script>
    <p id="end">end</p>
    <script>addEventListener("load", () => (document.title = "loaded"))</script>`,
  "/armed": () => `<!doctype html><title>Armed</title><p>Text</p>
    <script>window.arm = (ms) => setTimeout(() => (window.answer = confirm("During?")), ms);</script>`,
  "/key-confirm": () => `<!doctype html><title>Key confirm</title>
    <button onkeydown="if (event.key === ' ') confirm('Sure?')" onkeyup="window.keyUp = true">Go</button>`,
  "/stream-link": () => `<!doctype html><title>Link</title><a href="/stream">Stream</a>`,
  "/fieldset": () => `<!doctype html><title>Fieldset</title>
    <fieldset disabled>
      <label>Size <select><option>S</option><option>M</option></select></label>
      <label>Day <input type="date"></label>
      <label>Name <input></label>
    </fieldset>`,
  "/late-toggle": () => `<!doctype html><title>Late toggle</title>
    <div role="checkbox" aria-checked="false" tabindex="0" aria-label="Late"
      onclick="setTimeout(() => this.setAttribute('aria-checked', String(this.getAttribute('aria-checked') !== 'true')), 400)"
      onkeydown="window.keys = (window.keys || 0) + 1; if (event.key === ' ') this.click()">Late</div>`,
  "/table-item": () => {
    const cells = Array.from(
      { length: 6 },
      (_, row) =>
        `<tr>${Array.from({ length: 8 }, (_, column) => `<td>c${row}${column}</td>`).join(
          "",
        )}</tr>`,
    ).join("");
    return `<!doctype html><title>Table item</title><ul>
      <li><span>Order</span><table><tr><td><table>${cells}</table></td></tr></table>
        <button onclick="document.title = 'opened'">Open</button></li>
      <li>Other</li></ul>`;
  },
  "/pickers": () => `<!doctype html><title>Pickers</title>
    <label>Day <input type="date"></label>
    <label>Slot <input type="time"></label>
    <label>Tint <input type="color"></label>
    <details><summary>More</summary><p>Hidden text</p></details>`,
  "/toggle-row": () => `<!doctype html><title>Toggle row</title>
    <div id="row" style="display: flex; width: 400px; height: 40px">
      <input type="checkbox" aria-label="Pick">
      <button style="flex: 1" onclick="document.title = 'deleted'">Delete</button>
    </div>`,
  "/type-dialog": () => `<!doctype html><title>Type dialog</title>
    <input aria-label="Name" oninput="if (this.value === 'ab') confirm('Stop?')">`,
  "/presentational-frame": () => `<!doctype html><title>Presentational frame</title>
    <iframe role="presentation" srcdoc="<button onclick=&quot;parent.document.title = 'inner'&quot;>Inner</button>"></iframe>`,
  "/tall": () => `<!doctype html><title>Tall</title>
    <div id="tall" style="width: 200px; height: 2000px; background: rgb(255, 0, 0)"></div>`,
  "/shift-keys": () => `<!doctype html><title>Shift keys</title><input aria-label="Field">`,
  "/submit": () => `<!doctype html><title>Submit</title>
    <form onsubmit="event.preventDefault(); document.title = 'submitted'"><input aria-label="Name"></form>`,
  "/far-element": () => `<!doctype html><title>Far element</title>
    <div style="height: 1500px"></div><p id="far">Far</p>`,
  "/hover-leave": () => `<!doctype html><title>Hover leave</title>
    <button style="position: absolute; left: 0; top: 0; width: 200px; height: 60px" onmouseover="location.href = '/hover-landing'" onclick="document.title = 'saved'">Save</button>`,
  "/hover-landing": () => `<!doctype html><title>Landing</title>
    <button style="position: absolute; left: 0; top: 0; width: 200px; height: 60px" onclick="document.title = 'deleted'">Delete</button>`,
  "/recycle-hover": () => `<!doctype html><title>Recycle</title><ul>
      <li><span>Order A</span> <button onmouseover="this.previousElementSibling.textContent = 'Order B'" onclick="document.title = 'deleted ' + this.previousElementSibling.textContent">Delete</button></li>
      <li><span>Order C</span> <button>Archive</button></li>
    </ul>`,
  "/rerender-switch": () => `<!doctype html><title>Rerender</title><div id="host"></div>
    <script>
      let on = false;
      const render = () => {
        document.getElementById("host").innerHTML =
          '<button role="switch" aria-checked="' + on + '">Wifi</button>';
        document.querySelector("[role=switch]").onclick = () => {
          on = !on;
          render();
        };
      };
      render();
    </script>`,
  "/renaming-checkbox": () => `<!doctype html><title>Renaming</title>
    <label><input type="checkbox" onmouseover="this.nextElementSibling.textContent = 'Row B'">
      <span>Row A</span></label>`,
  "/order-row": () => `<!doctype html><title>Orders</title><ul>
      <li><span>Order A</span>
        <button onclick="document.title = 'deleted ' + this.previousElementSibling.textContent">Delete</button></li>
    </ul>`,
  "/leave-link": () => `<!doctype html><title>Leave link</title>
    <button>Touch</button> <a href="/basic">Away</a>
    <script>
      addEventListener("beforeunload", (event) => {
        event.preventDefault();
        event.returnValue = "";
      });
    </script>`,
  "/down-alert": () => `<!doctype html><title>Down alert</title>
    <button onmousedown="alert('down')" onmouseup="window.ups = (window.ups || 0) + 1"
      onclick="document.title = 'clicked'">Down</button>`,
  "/blank": () => "",
  "/to-replace": () => `<!doctype html><title>To replace</title><a href="/replace-early">Go</a>`,
  "/replace-early": () => `<!doctype html><title>Early</title>
    <script>history.replaceState(null, "", location.pathname + "#ready")</script>
    <script src="/blank?ms=1200"></script>
    <p>Loaded</p>`,
  "/popup-later": () => `<!doctype html><title>Popup later</title>
    <button onclick="setTimeout(() => window.open('/basic'), 300); setTimeout(() => document.body.append('ready now'), 900)">Start</button>`,
  "/shadow-text": () => `<!doctype html><title>Shadow text</title><div id="host"></div>
    <script>
      const root = document.getElementById("host").attachShadow({ mode: "open" });
      setTimeout(() => (root.innerHTML = "<p>Shadow hello</p>"), 300);
    </script>`,
  "/busy-hover": () => `<!doctype html><title>Busy hover</title>
    <button onmouseover="const end = Date.now() + 1500; while (Date.now() < end) {}"
      onclick="document.title = 'clicked'">Busy</button>`,
  "/type-fields": () => `<!doctype html><title>Type fields</title>
    <label>Locked <input readonly value="x"></label>
    <label>Day <input id="day" type="date"></label>`,
  "/mixed": () => `<!doctype html><title>Mixed</title>
    <label><input id="mixed" type="checkbox"> Mixed</label>
    <script>
      const box = document.getElementById("mixed");
      box.checked = true;
      box.indeterminate = true;
    </script>`,
  "/vanish": () => `<!doctype html><title>Vanish</title>
    <label>Vanish <input onfocus="this.remove()"></label>`,
  "/cell-input": () => `<!doctype html><title>Cells</title><table>
      <thead><tr><th>Item</th></tr></thead>
      <tbody><tr><td><input aria-label="Qty" value="1"> <button>Go</button></td></tr></tbody>
    </table>`,
  "/secret-closed": () => `<!doctype html><title>Closed</title><div id="host"></div>
    <p>Code: closed-secret-99</p>
    <div contenteditable style="-webkit-text-security: disc">editable-secret-77</div>
    <script>
      const root = document.getElementById("host").attachShadow({ mode: "closed" });
      root.innerHTML = '<input type="password" value="closed-secret-99">';
    </script>`,
  "/clipped": () => `<!doctype html><title>Clipped</title>
    <div style="height: 100px; overflow: clip; margin-top: 20px">
      <button style="display: block; height: 300px; width: 200px"
        onmouseover="document.title = 'hovered'" onclick="document.title = 'clicked'">Tall</button>
    </div>
    <div style="height: 400px">below</div>`,
  "/far": () => `<!doctype html><title>Far</title>
    <div style="height: 2000px"></div>
    <button onclick="document.title = 'clicked'">Far</button>`,
  "/long-cards": () => `<!doctype html><title>Cards</title><div>
      ${["A", "B", "C"]
        .map(
          (name) => `<div><h3>Card ${name}</h3><p>${`Details for card ${name}. `.repeat(30)}</p>
            <button onmouseover="this.parentElement.querySelector('h3').textContent = 'Card Z'"
              onclick="document.title = 'opened ' + this.parentElement.querySelector('h3').textContent">Open</button></div>`,
        )
        .join("")}
    </div>`,
  "/covered-far": () => `<!doctype html><title>Covered far</title>
    <div style="height: 2000px"></div>
    <button id="far" onclick="document.title = 'clicked'">Far</button>
    <div style="position: fixed; inset: 0; background: rgba(0, 0, 0, 0.2)"></div>`,
  "/opener": () => `<!doctype html><title>Opener</title>
    <button onclick="window.open('/basic')">Open</button>`,
  "/replace": () => `<!doctype html>
    <button id="target" onclick="document.title = 'first'">Delete</button>
    <script>
      window.replaceButton = () => {
        const next = document.createElement("button");
        next.textContent = "Delete";
        next.onclick = () => (document.title = "second");
        document.getElementById("target").replaceWith(next);
      };
    </script>`,
  "/cursor": () => `<!doctype html>
    <div id="card" style="cursor: pointer; width: 160px; height: 40px">Open card</div>
    <script>
      window.mutations = 0;
      new MutationObserver((records) => (window.mutations += records.length)).observe(document, {
        attributes: true,
        childList: true,
        subtree: true,
      });
      document.getElementById("card").addEventListener("click", () => (document.title = "card"));
    </script>`,
  "/virtual": () => `<!doctype html>
    <ul id="list"></ul>
    <script>
      const list = document.getElementById("list");
      const labels = [];
      for (let i = 0; i < 3; i++) {
        const item = document.createElement("li");
        const label = document.createElement("span");
        const button = document.createElement("button");
        button.textContent = "Delete";
        button.onclick = () => (document.title = "deleted " + label.textContent);
        item.append(label, button);
        list.append(item);
        labels.push(label);
      }
      let offset = 0;
      const draw = () => labels.forEach((label, i) => (label.textContent = "Item " + (offset + i)));
      window.shift = () => {
        offset += 1;
        draw();
      };
      draw();
    </script>`,
  "/mail-cards": () => `<!doctype html><title>Inbox</title>
    <h1>Inbox</h1>
    <div id="cards"></div>
    <section><div id="notes"></div></section>
    <script>
      let first = 0;
      const cards = document.getElementById("cards");
      const notes = document.getElementById("notes");
      for (let i = 0; i < 3; i++) {
        const card = document.createElement("div");
        card.style.cursor = "pointer";
        card.innerHTML = "<b></b> <span></span>";
        card.onclick = () => (document.title = "open " + card.dataset.id);
        cards.append(card);
        const note = document.createElement("div");
        note.style.cursor = "pointer";
        note.onclick = () => (document.title = "note " + note.dataset.id);
        notes.append(note);
      }
      const render = () => {
        cards.querySelectorAll(":scope > div").forEach((card, i) => {
          card.dataset.id = String(first + i);
          card.querySelector("b").textContent = "Email " + (first + i);
          card.querySelector("span").textContent = "from sender " + (first + i);
        });
        notes.querySelectorAll(":scope > div").forEach((note, i) => {
          note.dataset.id = String(first + i);
          note.textContent = "Note " + (first + i);
        });
      };
      render();
      window.shift = () => {
        first++;
        render();
      };
    </script>`,
  "/article": () => `<!doctype html><title>Article</title>
    <main>
      <article>
        <h1>Release notes</h1>
        <p>The engine now reads a page as Markdown, so an agent can read long text without a snapshot. It keeps links such as <a href="/docs">the docs</a> and lists.</p>
        <ul><li>First point</li><li>Second point</li></ul>
        <p>Sign in with <input type="password" value="hunter2-secret"> and the words hunter2-secret stay hidden.</p>
        <img src="data:image/png;base64,iVBORw0KGgo=" alt="pixel">
      </article>
    </main>`,
  "/pad": () => `<!doctype html><title>Pad</title>
    <div id="pad" style="position: absolute; left: 0; top: 0; width: 400px; height: 300px"></div>
    <input id="field" aria-label="Field" style="position: absolute; left: 0; top: 320px">
    <script>
      window.log = [];
      const pad = document.getElementById("pad");
      for (const type of ["mousedown", "mousemove", "mouseup", "click", "dblclick", "contextmenu", "wheel"]) {
        pad.addEventListener(type, (event) => {
          if (type === "mousemove" && !event.buttons) {
            return;
          }
          window.log.push([type, event.clientX, event.clientY, event.button, event.buttons, event.shiftKey, event.deltaY || 0].join(" "));
          if (type === "contextmenu" || type === "wheel") {
            event.preventDefault();
          }
        }, { passive: false });
      }
    </script>`,
  "/rows": () => `<!doctype html>
    <div id="list"></div>
    <script>
      const list = document.getElementById("list");
      const labels = [];
      for (let i = 0; i < 3; i++) {
        const row = document.createElement("div");
        const label = document.createElement("span");
        const button = document.createElement("button");
        button.textContent = "Archive";
        button.onclick = () => (document.title = "archived " + label.textContent);
        row.append(label, button);
        list.append(row);
        labels.push(label);
      }
      let offset = 0;
      const draw = () => labels.forEach((label, i) => (label.textContent = "Order " + (1000 + offset + i)));
      window.shift = () => {
        offset += 1;
        draw();
      };
      window.badge = () => {
        const badge = document.createElement("em");
        badge.textContent = "New";
        labels[0].parentElement.append(badge);
      };
      draw();
    </script>`,
  "/covered": () => `<!doctype html>
    <button onclick="document.title = 'clicked'">Buy</button>
    <div id="overlay" style="position: fixed; inset: 0; background: rgba(0, 0, 0, 0.3)"></div>`,
  "/frame": () => `<!doctype html><h1>Parent</h1>
    <iframe src="/inner" width="300" height="120"></iframe>`,
  "/inner": () => `<!doctype html>
    <button onclick="parent.document.title = 'inner'">Inner</button>`,
  "/oopif": (other) => `<!doctype html><h1>Host</h1>
    <iframe src="${other}/remote" width="300" height="120"></iframe>`,
  "/remote": () => `<!doctype html>
    <button onclick="document.body.dataset.clicked = 'yes'">Remote</button>`,
  "/slow": () => `<!doctype html><title>Slow</title><p>Done</p>`,
  "/forms": () => `<!doctype html><title>Forms</title>
    <input aria-label="Name" value="old">
    <textarea aria-label="Notes"></textarea>
    <div contenteditable="true" aria-label="Editor">draft</div>
    <select aria-label="Size"><option value="s">Small</option><option value="m">Medium</option><option value="l">Large</option></select>
    <select aria-label="Toppings" multiple><option>Cheese</option><option>Olives</option></select>
    <label><input type="checkbox" id="terms"> Accept terms</label>
    <label><input type="checkbox" id="news" style="display: none"><span>Newsletter</span></label>
    <input aria-label="Search" onkeydown="if (event.key === 'Enter') document.title = 'searched ' + this.value">
    <div style="height: 3000px">tall</div>
    <script>
      window.events = [];
      const name = document.querySelector("input");
      for (const type of ["input", "change", "keydown"]) name.addEventListener(type, () => events.push(type));
    </script>`,
  "/reads": () => `<!doctype html><title>Reads</title>
    <h1 id="head" data-kind="title">Hello <b>world</b></h1>
    <input aria-label="Email" value="a@b.c">
    <input type="password" aria-label="Password" value="secret">
    <button disabled>Off</button>
    <button>On</button>
    <input type="checkbox" aria-label="Agree" checked>
    <div id="later"></div>
    <p style="display: none">Hidden text</p>
    <script>
      setTimeout(() => {
        document.getElementById("later").innerHTML = "<button>Ready</button>";
        history.pushState({}, "", "/reads/done");
      }, 300);
    </script>`,
  "/upload": () => `<!doctype html><title>Upload</title>
    <input type="file" aria-label="Single" onchange="document.title = 'got ' + Array.from(this.files).map((file) => file.name + ':' + file.size).join(',')">
    <input type="file" aria-label="Many" multiple onchange="document.title = 'many ' + this.files.length">
    <button>Not a file input</button>`,
  "/drag": () => `<!doctype html><title>Drag</title>
    <div draggable="true" style="width: 80px; height: 40px">Card</div>
    <div id="zone" style="width: 120px; height: 60px; margin-top: 80px">Drop zone</div>
    <script>
      document.querySelector("[draggable]").addEventListener("dragstart", (event) => event.dataTransfer.setData("text/plain", "card"));
      const zone = document.getElementById("zone");
      zone.addEventListener("dragover", (event) => event.preventDefault());
      zone.addEventListener("drop", (event) => {
        event.preventDefault();
        document.title = "dropped " + event.dataTransfer.getData("text/plain");
      });
    </script>`,
  "/secrets": () => `<!doctype html><title>Secrets</title>
    <input aria-label="User" value="jun@steel.dev">
    <input type="password" aria-label="Password" value="hunter2">
    <input aria-label="Vault" value="vault-secret" style="filter: blur(5px); -webkit-text-security: disc">`,
  "/secret-name": () => `<!doctype html><title>Secret name</title>
    <button>Code <input style="-webkit-text-security: disc" value="9876"></button>
    <label>PIN <input style="-webkit-text-security: disc" value="4321"></label>`,
  "/secret-paths": () => `<!doctype html><title>Secret paths</title>
    <label for="other">Use <input style="-webkit-text-security: disc" value="5150"></label>
    <input id="other">
    <button>Code <input style="-webkit-text-security: disc" value="9876"></button>
    <div id="box">Note <textarea style="-webkit-text-security: disc">hunter22</textarea>
      <input type="password" value="pass1234"></div>
    <div style="cursor: pointer">Open<script>window.token = "zzz-script";</script><span hidden>hidden words</span></div>`,
  "/secret-html": () => `<!doctype html><title>Secret HTML</title>
    <div id="box"><input type="password" value="pass&amp;&lt;123">
      <p title="pass&amp;&lt;123">Shown: pass&amp;&lt;123</p></div>`,
  "/secret-textarea": () => `<!doctype html><title>Secret textarea</title>
    <textarea aria-label="Recovery" style="-webkit-text-security: disc">swordfish-42</textarea>
    <button>Paste swordfish-42</button>`,
  "/short-cover": () => `<!doctype html><title>Short cover</title>
    <button onclick="document.title = 'under'">Under</button>
    <button style="position: fixed; inset: 0; opacity: 0.5">PIN
      <input style="-webkit-text-security: disc" value="42"></button>`,
  "/short-secret": () => `<!doctype html><title>Short secret</title>
    <button>PIN <input style="-webkit-text-security: disc" value="42"></button>`,
  "/download": () => `<!doctype html><title>Download</title><a href="/file">Get report</a>`,
  "/secret-editable": () => `<!doctype html><title>Secret editable</title>
    <div style="cursor: pointer">Note <span contenteditable style="-webkit-text-security: disc">zqx</span></div>`,
  "/secret-shadow-name": () => `<!doctype html><title>Shadow name</title>
    <button>PIN <span id="host"></span></button>
    <script>
      document.getElementById("host").attachShadow({ mode: "closed" }).innerHTML =
        '<input style="-webkit-text-security: disc" value="qzv">';
    </script>`,
  "/secret-shadow-cover": () => `<!doctype html><title>Shadow cover</title>
    <button onclick="document.title = 'under'">Under</button>
    <button style="position: fixed; inset: 0; opacity: 0.5">PIN <span id="host"></span></button>
    <script>
      document.getElementById("host").attachShadow({ mode: "closed" }).innerHTML =
        '<input style="-webkit-text-security: disc" value="qzv">';
    </script>`,
  "/key-widget": () => `<!doctype html><title>Key widget</title>
    <input aria-label="Logged" onkeydown="log.push('down:' + event.key)" onkeyup="log.push('up:' + event.key)">
    <div role="textbox" tabindex="0" aria-label="Widget" onkeydown="if (event.key.length === 1) this.textContent += event.key"></div>
    <input aria-label="Plain">
    <script>window.log = [];</script>`,
  "/check-popup": () => `<!doctype html><title>Check popup</title>
    <label><input type="checkbox" onclick="event.preventDefault(); window.open('/basic'); setTimeout(() => { const next = this.cloneNode(); next.checked = true; this.replaceWith(next); }, 300)"> Agree</label>`,
  "/chatty": () => `<!doctype html><title>Chatty</title><p>busy</p>
    <script>setInterval(() => fetch("/blank?ms=50").catch(() => {}), 100);</script>`,
  "/deep-frame": (other) => `<!doctype html><title>Deep frame</title>
    <div style="height: 1500px"></div>
    <iframe src="${other}/deep-inner" style="width: 300px; height: 200px"></iframe>`,
  "/deep-inner": () => `<!doctype html><title>Deep inner</title>
    <div style="height: 1500px"></div>
    <button onclick="document.title = 'deep'">Deep</button>`,
  "/close-account": () => `<!doctype html><title>Close account</title>
    <div role="dialog" aria-labelledby="close-title" style="position: fixed; inset: 40px; border: 1px solid">
      <h2 id="close-title" style="margin: 0">Close account</h2>
      <button onclick="document.title = 'closed'" style="position: absolute; inset: 30% 10%">Yes, close it</button>
    </div>`,
  "/close-account-full": () => `<!doctype html><title>Close account</title>
    <div role="dialog" aria-label="Danger zone" style="position: fixed; inset: 40px">
      <button onclick="document.title = 'closed'" style="width: 100%; height: 100%">Yes, close it</button>
    </div>`,
  "/ambiguous": () => `<!doctype html><title>Ambiguous</title>
    <button onclick="document.title = 'first'">Save</button>
    <button onclick="document.title = 'second'">Save</button>
    <button style="display: none" onclick="document.title = 'hidden'">Send</button>
    <button onclick="document.title = 'send'">Send</button>`,
  "/disabled-controls": () => `<!doctype html><title>Disabled</title>
    <button disabled onclick="document.title = 'clicked'">Locked</button>
    <div role="button" tabindex="0" aria-disabled="true" onclick="document.title = 'aria'">Aria locked</div>
    <label><input type="checkbox" disabled> Off</label>
    <input type="file" aria-label="Attach" disabled onchange="document.title = 'attached'">`,
  "/busy-frame": (other) => `<!doctype html><title>Busy frame</title>
    <p>Outer</p>
    <iframe src="${other}/busy-inner"></iframe>`,
  "/busy-inner": () => `<!doctype html><title>Busy inner</title><p>Inner</p>
    <script>setTimeout(() => { const end = Date.now() + 6000; while (Date.now() < end) {} }, 300);</script>`,
  "/secret-markup": () => `<!doctype html><title>Secret markup</title>
    <div id="box">Note <div contenteditable style="-webkit-text-security: disc">qqqq<b>zzzz</b><div>wwww</div></div></div>`,
  "/many-buttons": () => `<!doctype html><title>Many</title>
    ${[1, 2, 3, 4, 5, 6, 7, 8]
      .map((n) => `<button onclick="document.title = this.textContent">B${n}</button>`)
      .join("")}`,
  "/offset-frame": (other) => `<!doctype html><title>Offset frame</title>
    <div style="height: 150px"></div>
    <iframe src="${other}/offset-inner" style="border: 0; width: 300px; height: 100px"></iframe>`,
  "/offset-inner": () => `<!doctype html><title>Offset inner</title><button>Inside</button>`,
  "/prefilled": () => `<!doctype html><title>Prefilled</title>
    <input aria-label="Filled" value="old">
    <textarea aria-label="Notes">old</textarea>
    <div contenteditable aria-label="Editor">old</div>
    <input aria-label="Placed" value="old">`,
  "/hidden-later": () => `<!doctype html><title>Hidden later</title>
    <button id="later" style="display: none" onclick="document.title = 'later'">Later</button>`,
  "/status-row": () => `<!doctype html><title>Status</title>
    <div><span id="status">Saved 3</span> <button onclick="document.title = 'saved'">Save</button></div>`,
  "/secret-cut": () => `<!doctype html><title>Secret cut</title>
    <input type="password" aria-label="Pass" value="hunter2secret">
    <div style="cursor: pointer">${"x".repeat(95)} hunter2secret tail</div>`,
  "/typed-kinds": () => `<!doctype html><title>Kinds</title>
    <input type="email" aria-label="Email" value="old@x.com">
    <input type="number" aria-label="Count" value="12">`,
  "/with-cursor": () => `<!doctype html><title>Cursor</title>
    <div class="item">One</div><div class="item">Two</div>
    <div id="__cursor__" style="position: fixed; top: 0; left: 0; width: 20px; height: 20px; pointer-events: none"></div>`,
  "/frame-history": () => `<!doctype html><title>Frame history</title><p>Outer</p>
    <iframe src="/frame-a" style="width: 300px; height: 100px"></iframe>`,
  "/frame-a": () => `<!doctype html><title>Frame A</title><a href="/frame-b">Next</a>`,
  "/frame-b": () => `<!doctype html><title>Frame B</title><p>B</p>`,
  "/hidden-pair": () => `<!doctype html><title>Hidden pair</title>
    <button style="display: none">Retry</button><button style="display: none">Retry</button>
    <script>window.reveal = () => (document.querySelector("button").style.display = "");</script>`,
  "/hidden-text": () => `<!doctype html><title>Hidden text</title>
    <div id="t"><span style="display: none">hidden words</span></div>`,
  "/card-check": () => `<!doctype html><title>Card check</title>
    <div id="deep" style="cursor: pointer; padding: 8px" onclick="document.title = 'opened'">
      <h3>Card</h3><p>Details</p>
      <div><div><input type="checkbox" style="display: none"></div></div>
      <button onclick="event.stopPropagation()">More</button>
    </div>
    <div id="shallow" style="cursor: pointer; padding: 8px" onclick="document.title = 'opened'">
      <input type="checkbox" style="display: none">
      <h3>Other card</h3>
      <button onclick="event.stopPropagation()">Other</button>
    </div>`,
  "/shadow-label": () => `<!doctype html><title>Shadow label</title>
    <span id="field-label">Phone</span>
    <input aria-labelledby="field-label" oninput="document.title = 'phone ' + this.value">
    <div id="host"></div>
    <script>
      document.getElementById("host").attachShadow({ mode: "open" }).innerHTML =
        '<span id="field-label">Email</span><input aria-labelledby="field-label" oninput="document.title = \\'email \\' + this.value">';
    </script>`,
  "/secret-inner": () => `<!doctype html><title>Secret inner</title>
    <div contenteditable style="-webkit-text-security: disc">alpha<b id="inner">bravo</b>charlie</div>`,
  "/busy-later": () => `<!doctype html><title>Busy later</title><p>Busy</p>
    <script>setTimeout(() => { const end = Date.now() + 6000; while (Date.now() < end) {} }, 300);</script>`,
  "/confirm-now": () =>
    `<!doctype html><title>Confirm now</title><script>confirm("Ready?")</script>`,
  "/danger": () => `<!doctype html><title>Danger</title>
    <h1>Danger</h1>
    <label>Name <input id="name"></label>
    <button onclick="document.title = 'deleted'">Delete account</button>
    <a href="/next">Next page</a>`,
  "/focus-confirm": () => `<!doctype html><title>Focus confirm</title>
    <input aria-label="Trap" onfocus="if (!window.asked) { window.asked = true; confirm('Sure?'); }">
    <button onclick="document.title = 'clicked'">Go</button>`,
  "/locators": () => `<!doctype html><title>Locators</title>
    <label for="email">Email address</label><input id="email">
    <input placeholder="Search here">
    <img alt="Company logo" width="10" height="10">
    <button title="Close panel" onclick="document.title = 'closed'">x</button>
    <button data-testid="save-button" onclick="document.title = 'saved'">Save</button>
    <button onclick="document.title = 'first'">Item</button>
    <button onclick="document.title = 'second'">Item</button>
    <p>Read the <b>terms</b> carefully</p>
    <div onmouseenter="document.title = 'hovered'" style="width: 120px; height: 30px">Hover me</div>
    <div ondblclick="document.title = 'double'" style="width: 120px; height: 30px">Double</div>
    <input onfocus="document.title = 'focused'" aria-label="Focus target">
    <div role="button" tabindex="0" aria-labelledby="caption" onclick="document.title = 'labelled'">?</div>
    <span id="caption">Labelled by caption</span>`,
  "/outline": () => `<!doctype html><title>Outline</title>
    <ul><li>plain item</li><li>second <a href="#">link</a></li></ul>
    <p>Note: plain text</p>
    <textarea aria-label="Notes">line one
line two</textarea>`,
  "/cover": () => `<!doctype html><title>Cover</title>
    <style>
      #card { position: relative; width: 220px; height: 60px; }
      #card::after { content: ""; position: absolute; inset: 0; }
      .wrap { width: 160px; font: 16px/20px monospace; }
    </style>
    <div id="card"><button onclick="document.title = 'inner'">Inner</button></div>
    <button id="icon" onclick="document.title = 'icon'"><span style="pointer-events: none">Icon</span></button>
    <div class="wrap">aaaa bbbb cc <a href="#" onclick="document.title = 'wrapped'; return false">wrapped link here</a> dd</div>
    <div style="position: relative; width: 200px"><input id="field" aria-label="Field" onfocus="document.title = 'field'"><label for="field" style="position: absolute; inset: 0">Float</label></div>
    <a href="#" class="stretch" onclick="document.title = 'stretched'; return false" style="position: relative; display: block; width: 200px"><h3 style="margin: 0">Story title</h3></a>
    <style>.stretch::after { content: ""; position: absolute; inset: 0; }</style>
    <div style="height: 2000px"></div>
    <button onclick="document.title = 'low'">Low</button>
    <div style="position: relative"><button onclick="document.title = 'shaded'">Shaded</button><div style="position: absolute; inset: 0"></div></div>`,
  "/keys": () => `<!doctype html><title>Keys</title>
    <input aria-label="First"><input aria-label="Second">
    <input aria-label="Limited" maxlength="3">
    <input aria-label="Locked" readonly value="fixed">
    <input type="date" aria-label="Day">
    <div aria-label="Wrapper"><span>not focusable</span></div>
    <input aria-label="Tracked" value="old">
    <script>
      window.inputTypes = [];
      document.querySelector('[aria-label="Tracked"]').addEventListener("input", (event) => inputTypes.push(event.inputType));
      window.keys = [];
      addEventListener("keydown", (event) => keys.push(event.key));
    </script>`,
  "/toggles": () => `<!doctype html><title>Toggles</title>
    <div role="checkbox" aria-checked="false" tabindex="0" aria-label="Aria box" id="aria" style="width: 20px; height: 20px"></div>
    <button aria-pressed="false" onclick="this.setAttribute('aria-pressed', String(this.getAttribute('aria-pressed') !== 'true'))">Bold</button>
    <input type="radio" name="size" aria-label="Small" checked><input type="radio" name="size" aria-label="Large">
    <div style="position: relative; width: 40px"><input type="checkbox" aria-label="Covered box" id="covered"><div style="position: absolute; inset: -4px; background: rgba(0, 0, 0, 0.1)"></div></div>
    <p>Plain text</p>
    <script>
      const box = document.getElementById("aria");
      const flip = () => box.setAttribute("aria-checked", String(box.getAttribute("aria-checked") !== "true"));
      box.addEventListener("click", flip);
      box.addEventListener("keydown", (event) => {
        if (event.key === " ") {
          event.preventDefault();
          flip();
        }
      });
    </script>`,
  "/options": () => `<!doctype html><title>Options</title>
    <select aria-label="Plan">
      <option value="free">Free</option>
      <option value="pro" disabled>Pro</option>
      <optgroup label="Teams" disabled><option value="team">Team</option></optgroup>
      <option value="a1">Same</option>
      <option value="a2">Same</option>
      <option value="ent">Enterprise</option>
    </select>
    <div style="opacity: 0"><button>Ghost</button></div>
    <button>Shown</button>
    <script>
      window.changes = 0;
      document.querySelector("select").addEventListener("change", () => changes++);
    </script>`,
  "/popups": () => `<!doctype html><title>Popups</title>
    <button onclick="window.open('/popup-alert')">Alert popup</button>
    <button onclick="window.open('/popup-confirm')">Confirm popup</button>`,
  "/popup-alert": () => `<!doctype html><title>Before</title>
    <body><script>alert("early"); document.body.textContent = "after alert";</script></body>`,
  "/popup-confirm": () => `<!doctype html><title>Before</title>
    <body><script>document.body.textContent = "confirm " + confirm("early?");</script></body>`,
  "/nav": () => `<!doctype html><title>Nav</title>
    <a href="/slow?ms=400">Slow link</a>
    <a href="/slow?ms=1500">Very slow link</a>
    <button onclick="setTimeout(() => (location.href = '/slow?ms=200'), 0)">Later</button>
    <a href="#part">Hash</a>
    <button onclick="fetch('/data?ms=800').then(() => (document.title = 'loaded'))">Load</button>`,
  "/data": () => "ok",
  "/long": () => `<!doctype html><title>Long</title>
    <article><h1>Story</h1>${Array.from(
      { length: 300 },
      (_, i) => `<p>Paragraph ${i} with some words.</p>`,
    ).join("")}
    <a href="#" onclick="document.title = 'read more'; return false">Read more</a></article>`,
  "/frame-item": () => `<!doctype html><title>Frame item</title>
    <iframe src="/inner-item" width="300" height="120"></iframe>`,
  "/inner-item": () => `<!doctype html>
    <ul><li>Some sibling text <button onclick="parent.document.title = 'inner item'">Go</button></li></ul>`,
  "/oopif-cover": (other) => `<!doctype html><title>Covered frame</title>
    <div style="position: relative; width: 320px; height: 140px">
      <iframe src="${other}/remote?cover" width="300" height="120"></iframe>
      <div id="cover" style="position: absolute; inset: 0; background: rgba(0, 0, 0, 0.3)"></div>
    </div>`,
  "/scaled-cover": (other) => `<!doctype html><title>Scaled cover</title>
    <style>
      body { margin: 0 }
      iframe { border: 4px solid gray; transform: scale(0.5); transform-origin: 0 0 }
    </style>
    <iframe src="${other}/remote-corner" width="300" height="120"></iframe>
    <div id="cover" style="position: absolute; left: 0; top: 0; width: 60px; height: 30px; background: rgba(0, 0, 0, 0.3)"></div>`,
  "/scaled-far": (other) => `<!doctype html><title>Scaled far</title>
    <style>
      body { margin: 0 }
      iframe { border: 4px solid gray; transform: scale(0.25); transform-origin: 0 0 }
    </style>
    <iframe src="${other}/remote-far" width="300" height="120"></iframe>`,
  "/remote-corner": () => `<!doctype html><body style="margin: 0">
    <button style="position: absolute; left: 0; top: 0; width: 100px; height: 40px" onclick="document.body.dataset.clicked = 'yes'">Remote</button>`,
  "/remote-far": () => `<!doctype html><body style="margin: 0">
    <button style="position: absolute; left: 150px; top: 60px; width: 100px; height: 40px" onclick="document.body.dataset.clicked = 'yes'">Remote</button>`,
  "/oopif-low": (other) => `<!doctype html><title>Low frame</title>
    <div style="height: 2000px"></div>
    <iframe src="${other}/remote?low" width="300" height="120"></iframe>`,
  "/grow": () => `<!doctype html><title>Grow</title>
    <script>
      window.grow = () => {
        const box = document.createElement("div");
        box.id = "box";
        for (let i = 0; i < 400; i++) box.appendChild(document.createElement("span")).textContent = "x";
        box.appendChild(document.createElement("button")).textContent = "Grow";
        document.body.appendChild(box);
      };
      window.shrink = () => document.getElementById("box").remove();
    </script>`,
  "/role-order": () => `<!doctype html><title>Order</title>
    <div><div><div><button onclick="document.title = 'deep'">Save</button></div></div></div>
    <button onclick="document.title = 'shallow'">Save</button>`,
  "/dialogs": () => `<!doctype html><title>Dialogs</title>
    <button onclick="alert('Hello'); document.title = 'alerted'">Alert</button>
    <button onclick="document.title = 'confirm ' + confirm('Sure?')">Confirm</button>
    <button onclick="document.title = 'prompt ' + prompt('Name?', 'anon')">Prompt</button>
    <button onclick="setTimeout(() => (document.title = 'later ' + confirm('Later?')), 300)">Later</button>
    <button onclick="const end = Date.now() + 30000; while (Date.now() < end) {} document.title = 'spun'">Spin</button>
    <button onmousedown="window.held = confirm('Down?')" onclick="document.title = 'clicked after ' + window.held">Hold</button>
    <div onmouseover="confirm('Hover?')" onclick="document.title = 'trap clicked'" style="width: 120px; height: 30px">Hover trap</div>`,
  "/leave": () => `<!doctype html><title>Leave</title><button>Touch</button>
    <script>
      addEventListener("beforeunload", (event) => {
        event.preventDefault();
        event.returnValue = "";
      });
    </script>`,
};

function refOf(snapshot: string, fragment: string): string {
  const line = snapshot.split("\n").find((candidate) => candidate.includes(fragment));
  const match = line?.match(/ref=(e\d+)/);
  if (!match) {
    throw new Error(`No ref for ${fragment} in:\n${snapshot}`);
  }
  return match[1];
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe.skipIf(!chrome)("command engine", () => {
  let server: Server;
  let port: number;
  let base: string;
  let other: string;
  let browser: Browser;
  let page: Page;
  let engine: CommandEngine;
  let host: EngineHost;
  let current: Browser;
  let releasing = false;
  let quickActions: Promise<void> = Promise.resolve();
  let endedByEngine = 0;
  let files: string;
  let outside: string;
  let downloads: string;

  beforeAll(async () => {
    const seen = new Map<string, number>();
    server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://fixture");
      if (url.pathname === "/stream") {
        response.writeHead(200, { "content-type": "text/html" });
        response.write(`<!doctype html><title>Stream</title><p>start</p>${" ".repeat(4096)}`);
        setTimeout(() => response.end("<p>end</p>"), 2500);
        return;
      }
      if (url.pathname === "/file") {
        response
          .writeHead(200, {
            "content-type": "application/octet-stream",
            "content-disposition": "attachment; filename=report.txt",
          })
          .end("hello");
        return;
      }
      const fixture = fixtures[url.pathname];
      if (!fixture) {
        response.writeHead(404).end();
        return;
      }
      const visits = (seen.get(request.url ?? "") ?? 0) + 1;
      seen.set(request.url ?? "", visits);
      const again = url.searchParams.get("again");
      setTimeout(
        () =>
          response
            .writeHead(200, {
              "content-type": "text/html",
              ...(again ? { "cache-control": "no-store" } : {}),
            })
            .end(fixture(other)),
        Number((visits > 1 && again) || url.searchParams.get("ms") || 0),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
    base = `http://main.test:${port}`;
    other = `http://frame.test:${port}`;
    browser = await puppeteer.launch({
      executablePath: chrome,
      headless: true,
      args: ["--no-sandbox", "--site-per-process", "--host-resolver-rules=MAP *.test 127.0.0.1"],
    });
    files = await mkdtemp(join(tmpdir(), "steel-files-"));
    outside = await mkdtemp(join(tmpdir(), "steel-outside-"));
    downloads = await mkdtemp(join(tmpdir(), "steel-downloads-"));
    await writeFile(join(files, "report.txt"), "hello");
    await writeFile(join(files, "data.csv"), "a,b\n");
    await writeFile(join(outside, "secret.txt"), "secret");
    await symlink(join(outside, "secret.txt"), join(files, "link.txt"));
    current = browser;
    host = {
      browser: () => current,
      waitForPageSetup: async () => undefined,
      endSession: async () => {
        endedByEngine++;
      },
      filesRoot: () => files,
      released: () => releasing,
      quickActionsDone: () => quickActions,
    };
  });

  afterAll(async () => {
    await browser?.close();
    server?.close();
    await Promise.all(
      [files, outside, downloads]
        .filter(Boolean)
        .map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  beforeEach(async () => {
    const previous = await browser.pages();
    page = await browser.newPage();
    await Promise.all(previous.map((candidate) => candidate.close()));
    engine = create();
  });

  afterEach(() => {
    engine.sessionEnded();
    endedByEngine = 0;
    releasing = false;
    quickActions = Promise.resolve();
    current = browser;
  });

  function create(options: EngineOptions = {}): CommandEngine {
    engine?.sessionEnded();
    engine = new CommandEngine(host, options);
    engine.prepare(SESSION);
    engine.browserReady();
    return engine;
  }

  async function send(body: unknown, key?: string, target = engine): Promise<EngineResponse> {
    return target.handle({ sessionId: SESSION, idempotencyKey: key, body });
  }

  async function run(commands: unknown, extra: Record<string, unknown> = {}, target = engine) {
    const response = await send({ commands, ...extra }, undefined, target);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return response.body as unknown as Envelope;
  }

  async function open(path: string, target = engine) {
    const body = await run({ command: "navigate", url: base + path }, {}, target);
    expect(body.results[0].ok, JSON.stringify(body)).toBe(true);
    return body;
  }

  async function snapshot(options: { interactive?: boolean } = {}): Promise<string> {
    const body = await run({ command: "snapshot", ...options });
    expect(body.results[0].ok, JSON.stringify(body)).toBe(true);
    return body.results[0].snapshot as string;
  }

  async function click(target: string): Promise<Result> {
    return (await run({ command: "click", target })).results[0];
  }

  async function finished(id: string, target = engine): Promise<Envelope> {
    for (let attempt = 0; attempt < 20; attempt++) {
      const body = await run({ command: "status", execution: id }, {}, target);
      if (!["queued", "running"].includes(body.execution.state)) {
        return body;
      }
    }
    throw new Error(`Execution ${id} did not finish`);
  }

  async function press(label: string, extra: Record<string, unknown> = {}, target = engine) {
    const text = (await run({ command: "snapshot" }, {}, target)).results[0].snapshot as string;
    return run({ command: "click", target: refOf(text, `button "${label}"`) }, extra, target);
  }

  async function tabWith(fragment: string, target = engine): Promise<string> {
    for (let attempt = 0; attempt < 30; attempt++) {
      const listed = await run({ command: "tab", action: "list" }, {}, target);
      const tabs = listed.results[0].tabs as Array<{ tab: string; url: string }>;
      const found = tabs.find((tab) => tab.url.includes(fragment));
      if (found) {
        return found.tab;
      }
      await sleep(100);
    }
    throw new Error(`No tab shows ${fragment}`);
  }

  async function held(): Promise<Record<string, unknown>> {
    return page.evaluate(() => {
      const { count, doubled, dragged, released, keyUp } = window as unknown as Record<
        string,
        unknown
      >;
      return { count, doubled, dragged, released, keyUp };
    });
  }

  function holdPress() {
    const original = CdpCDPSession.prototype.send;
    return vi.spyOn(CdpCDPSession.prototype, "send").mockImplementation(function (
      this: CdpCDPSession,
      method: string,
      params?: unknown,
      options?: unknown,
    ) {
      if (
        method === "Input.dispatchMouseEvent" &&
        (params as { type?: string } | undefined)?.type === "mousePressed"
      ) {
        return new Promise(() => {});
      }
      return (original as (...args: unknown[]) => Promise<unknown>).call(
        this,
        method,
        params,
        options,
      );
    } as never);
  }

  async function count(): Promise<number | undefined> {
    return page.evaluate(() => (window as unknown as { count?: number }).count);
  }

  describe("snapshot and click", () => {
    test("renders roles, names, and refs", async () => {
      await open("/basic");
      const text = await snapshot();
      expect(text).toMatch(/- heading "Account" \[level=1, ref=e\d+\]/);
      expect(text).toMatch(/- textbox "Name" \[ref=e\d+\]/);
      expect(text).toMatch(/- button "Save" \[ref=e\d+\]/);
      expect(text).toMatch(/- link "Next page" \[ref=e\d+\]/);
    });

    test("does not press another control inside the element it clicks", async () => {
      await open("/close-account");
      const body = await run({ command: "click", target: { label: "Close account" } });
      expect(body.results[0], JSON.stringify(body.results[0])).toMatchObject({ ok: true });
      expect(await page.title()).toBe("Close account");
      await open("/close-account-full");
      const full = await run({ command: "click", target: { label: "Danger zone" } });
      expect(full.results[0], JSON.stringify(full.results[0])).toMatchObject({
        ok: false,
        effect: "none",
        error: { code: "not_actionable", reason: "covered" },
      });
      expect(full.results[0].error!.message).toContain("Yes, close it");
      expect(await page.title()).toBe("Close account");
    });

    test("refuses a locator that matches several elements unless nth picks one", async () => {
      await open("/ambiguous");
      for (const target of [{ text: "Save" }, { role: "button", name: "Save" }]) {
        const body = await run({ command: "click", target });
        expect(body.results[0], JSON.stringify(target)).toMatchObject({
          ok: false,
          effect: "none",
          error: { code: "invalid_argument", reason: "ambiguous" },
        });
      }
      expect(await page.title()).toBe("Ambiguous");
      await run({ command: "click", target: { text: "Save", nth: 1 } });
      expect(await page.title()).toBe("second");
      const send = await run({ command: "click", target: { text: "Send" } });
      expect(send.results[0], JSON.stringify(send.results[0])).toMatchObject({ ok: true });
      expect(await page.title()).toBe("send");
      const count = await run({ command: "get", what: "count", target: { text: "Save" } });
      expect(count.results[0]).toMatchObject({ value: 2 });
    });

    test("reads labels inside the shadow root of the field", async () => {
      await open("/shadow-label");
      await run({ command: "fill", target: { label: "Email" }, value: "a@b.c" });
      expect(await page.title()).toBe("email a@b.c");
      await run({ command: "fill", target: { label: "Phone" }, value: "123" });
      expect(await page.title()).toBe("phone 123");
    });

    test("does not treat a card with a hidden checkbox inside as a checkbox", async () => {
      await open("/card-check");
      const text = await snapshot({ interactive: true });
      expect(text).not.toContain("checkbox");
      const checked = await run({ command: "check", target: { css: "#deep" } });
      expect(checked.results[0], JSON.stringify(checked.results[0])).toMatchObject({
        ok: false,
        effect: "none",
        error: { code: "not_actionable", reason: "not_checkable" },
      });
      const shallow = await run({ command: "check", target: { css: "#shallow" } });
      expect(shallow.results[0], JSON.stringify(shallow.results[0])).toMatchObject({
        ok: false,
        effect: "none",
        error: { code: "not_actionable" },
      });
      expect(await page.title()).toBe("Card check");
    });

    test("refuses disabled controls instead of reporting a click", async () => {
      await open("/disabled-controls");
      const refused = [
        { command: "click", target: { role: "button", name: "Locked", exact: true } },
        { command: "click", target: { text: "Aria locked" } },
        { command: "check", target: { label: "Off" } },
        { command: "upload", target: { label: "Attach" }, files: "report.txt" },
      ];
      for (const command of refused) {
        const body = await run(command);
        expect(body.results[0], JSON.stringify(command)).toMatchObject({
          ok: false,
          effect: "none",
          error: { code: "not_actionable", reason: "disabled" },
        });
      }
      expect(await page.title()).toBe("Disabled");
    });

    test("keeps the refs a snapshot shows when the page has more than the ref limit", async () => {
      const small = create({ limits: { maxRefs: 5 } });
      await open("/many-buttons", small);
      const text = (await run({ command: "snapshot" }, {}, small)).results[0].snapshot as string;
      const clicked = await run(
        { command: "click", target: refOf(text, 'button "B1"') },
        {},
        small,
      );
      expect(clicked.results[0], JSON.stringify(clicked.results[0])).toMatchObject({ ok: true });
      expect(await page.title()).toBe("B1");
      small.sessionEnded();
    });

    test("keeps every ref a find returns when there are more than the ref limit", async () => {
      const small = create({ limits: { maxRefs: 5 } });
      await open("/many-buttons", small);
      const found = await run({ command: "find", by: "role", value: "button" }, {}, small);
      const matches = found.results[0].matches as Array<{ ref: string; name: string }>;
      expect(matches).toHaveLength(8);
      const clicked = await run({ command: "click", target: matches[0].ref }, {}, small);
      expect(clicked.results[0], JSON.stringify(clicked.results[0])).toMatchObject({ ok: true });
      expect(await page.title()).toBe("B1");
      small.sessionEnded();
    });

    test("keeps a ref that find returned for a hidden element once it shows", async () => {
      await open("/hidden-later");
      const found = await run({ command: "find", by: "css", value: "#later" });
      const ref = (found.results[0].matches as Array<{ ref: string }>)[0].ref;
      await page.evaluate(() => (document.getElementById("later")!.style.display = ""));
      const clicked = await run({ command: "click", target: ref });
      expect(clicked.results[0], JSON.stringify(clicked.results[0])).toMatchObject({ ok: true });
      expect(await page.title()).toBe("later");
    });

    test("keeps a ref outside lists when text next to it changes", async () => {
      await open("/status-row");
      const ref = refOf(await snapshot(), 'button "Save"');
      await page.evaluate(() => (document.getElementById("status")!.textContent = "Saved 4"));
      const clicked = await run({ command: "click", target: ref });
      expect(clicked.results[0], JSON.stringify(clicked.results[0])).toMatchObject({ ok: true });
      expect(await page.title()).toBe("saved");
    });

    test("leaves the mouse helper out of locators and html", async () => {
      await open("/with-cursor");
      const count = await run({ command: "get", what: "count", target: { css: "div" } });
      expect(count.results[0]).toMatchObject({ value: 2 });
      const html = await run({ command: "get", what: "html", target: "body" });
      expect(String(html.results[0].value)).toContain("Two");
      expect(String(html.results[0].value)).not.toContain("__cursor__");
    });

    test("reads only the text a person can see", async () => {
      await open("/hidden-text");
      const text = await run({ command: "get", what: "text", target: "#t" });
      expect(text.results[0]).toMatchObject({ ok: true, value: "" });
    });

    test("waits on a locator that matches several hidden elements", async () => {
      await open("/hidden-pair");
      const hidden = await run({
        command: "wait",
        target: { text: "Retry" },
        state: "hidden",
        timeout: 1000,
      });
      expect(hidden.results[0], JSON.stringify(hidden.results[0])).toMatchObject({ ok: true });
      const none = await run({ command: "is", what: "visible", target: { text: "Retry" } });
      expect(none.results[0], JSON.stringify(none.results[0])).toMatchObject({ value: false });
      await page.evaluate(() =>
        setTimeout(() => (window as unknown as { reveal(): void }).reveal(), 300),
      );
      const visible = await run({
        command: "wait",
        target: { text: "Retry" },
        state: "visible",
        timeout: 3000,
      });
      expect(visible.results[0], JSON.stringify(visible.results[0])).toMatchObject({ ok: true });
      const some = await run({ command: "is", what: "visible", target: { text: "Retry" } });
      expect(some.results[0], JSON.stringify(some.results[0])).toMatchObject({ value: true });
    });

    test("treats a hidden element's ref as still in the page", async () => {
      await open("/basic");
      const ref = refOf(await snapshot(), 'button "Save"');
      await page.evaluate(() => (document.querySelector("button")!.style.display = "none"));
      const visible = await run({ command: "is", what: "visible", target: ref });
      expect(visible.results[0], JSON.stringify(visible.results[0])).toMatchObject({
        ok: true,
        value: false,
      });
      const gone = await run({ command: "wait", target: ref, state: "detached", timeout: 500 });
      expect(gone.results[0], JSON.stringify(gone.results[0])).toMatchObject({
        ok: false,
        error: { code: "timeout" },
      });
      const hidden = await run({ command: "wait", target: ref, state: "hidden", timeout: 500 });
      expect(hidden.results[0]).toMatchObject({ ok: true });
    });

    test("reports the box of an element in a cross-origin frame in page coordinates", async () => {
      await open("/offset-frame");
      const ref = refOf(await snapshot(), 'button "Inside"');
      const body = await run({ command: "get", what: "box", target: ref });
      const box = body.results[0].value as { x: number; y: number; width: number; height: number };
      const inner = page.frames().find((frame) => frame.url().includes("/offset-inner"))!;
      const expected = (await (await inner.$("button"))!.boundingBox())!;
      expect(Math.abs(box.x - expected.x), JSON.stringify(box)).toBeLessThan(1);
      expect(Math.abs(box.y - expected.y), JSON.stringify(box)).toBeLessThan(1);
      expect(box.y).toBeGreaterThan(140);
    });

    test("gives the same node the same ref and clicks it", async () => {
      await open("/basic");
      const first = refOf(await snapshot(), 'button "Save"');
      const second = refOf(await snapshot(), 'button "Save"');
      expect(second).toBe(first);
      expect(await click(first)).toMatchObject({ ok: true, effect: "applied" });
      expect(await page.title()).toBe("saved");
    });

    test("rejects a ref whose node was replaced", async () => {
      await open("/replace");
      const old = refOf(await snapshot(), 'button "Delete"');
      await page.evaluate(() =>
        (window as unknown as { replaceButton: () => void }).replaceButton(),
      );
      expect(await click(old)).toMatchObject({
        ok: false,
        effect: "none",
        error: { code: "stale_ref", reason: "detached" },
      });
      const fresh = refOf(await snapshot(), 'button "Delete"');
      expect(fresh).not.toBe(old);
      expect(await click(fresh)).toMatchObject({ ok: true });
      expect(await page.title()).toBe("second");
    });

    test("gives refs to date, time, and color inputs and to summary", async () => {
      await open("/pickers");
      const text = await snapshot({ interactive: true });
      for (const line of [
        'Date "Day"',
        'InputTime "Slot"',
        'ColorWell "Tint"',
        'DisclosureTriangle "More"',
      ]) {
        expect(text).toMatch(new RegExp(`${line} \\[[^\\]]*ref=e\\d+\\]`));
      }
      const body = await run([
        { command: "fill", target: refOf(text, 'Date "Day"'), value: "2026-10-22" },
        { command: "click", target: refOf(text, 'DisclosureTriangle "More"') },
        { command: "get", what: "value", target: refOf(text, 'Date "Day"') },
      ]);
      expect(body.results[2], JSON.stringify(body.results)).toMatchObject({
        ok: true,
        value: "2026-10-22",
      });
      expect(await page.evaluate(() => document.querySelector("details")!.open)).toBe(true);
    });

    test("finds cursor-interactive elements without touching the DOM", async () => {
      await open("/cursor");
      const text = await snapshot({ interactive: true });
      expect(text).toMatch(/"Open card" \[ref=e\d+\] clickable \[cursor:pointer\]/);
      expect(
        await page.evaluate(() => (window as unknown as { mutations: number }).mutations),
      ).toBe(0);
      expect(await click(refOf(text, "Open card"))).toMatchObject({ ok: true });
      expect(await page.title()).toBe("card");
    });

    test("notices a reused row in a virtual list", async () => {
      await open("/virtual");
      const deleteRef = refOf(await snapshot(), 'button "Delete"');
      expect(await click(deleteRef)).toMatchObject({ ok: true });
      expect(await page.title()).toBe("deleted Item 0");
      await page.evaluate(() => (window as unknown as { shift: () => void }).shift());
      expect(await click(deleteRef)).toMatchObject({
        ok: false,
        error: { code: "stale_ref", reason: "content_changed" },
      });
    });

    test("notices a reused card when the card itself is the ref", async () => {
      await open("/mail-cards");
      const lines = (await snapshot()).split("\n");
      const above = (fragment: string) =>
        lines[lines.findIndex((line) => line.includes(fragment)) - 1].match(/ref=(e\d+)/)![1];
      const card = above("Email 0");
      const note = above("Note 0");
      await page.evaluate(() => (window as unknown as { shift: () => void }).shift());
      for (const ref of [card, note]) {
        const result = await click(ref);
        expect(result, `${ref} ${JSON.stringify(result)}`).toMatchObject({
          ok: false,
          error: { code: "stale_ref", reason: "content_changed" },
        });
      }
      expect(await page.title()).toBe("Inbox");
    });

    test("notices a reused row in a list without roles", async () => {
      await open("/rows");
      const archive = refOf(await snapshot(), 'button "Archive"');
      await page.evaluate(() => (window as unknown as { shift: () => void }).shift());
      expect(await click(archive)).toMatchObject({
        ok: false,
        error: { code: "stale_ref", reason: "content_changed" },
      });
    });

    test("keeps a ref inside a list item that holds nested tables", async () => {
      await open("/table-item");
      expect(await click(refOf(await snapshot(), 'button "Open"'))).toMatchObject({ ok: true });
      expect(await page.title()).toBe("opened");
    });

    test("keeps a ref when text is only added around it", async () => {
      await open("/rows");
      const archive = refOf(await snapshot(), 'button "Archive"');
      await page.evaluate(() => (window as unknown as { badge: () => void }).badge());
      expect(await click(archive)).toMatchObject({ ok: true });
      expect(await page.title()).toBe("archived Order 1000");
    });

    test("keeps refs when the fields next to them change", async () => {
      await open("/edit");
      const text = await snapshot({ interactive: true });
      const body = await run([
        { command: "fill", target: refOf(text, 'textbox "Name"'), value: "new" },
        { command: "fill", target: "#notes", value: "second draft" },
        { command: "fill", target: refOf(text, 'textbox "Task"'), value: "Buy bread" },
        { command: "click", target: refOf(text, 'button "Keep"') },
        { command: "get", what: "title" },
        { command: "click", target: refOf(text, 'button "Save"') },
        { command: "get", what: "title" },
      ]);
      expect(body.execution.state, JSON.stringify(body.results)).toBe("completed");
      expect(body.results[4].value).toBe("kept Buy bread");
      expect(body.results[6].value).toBe("saved new second draft");
    });

    test("does not click on a page that hovering navigated to", async () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        await open("/hover-leave");
        const result = await click(refOf(await snapshot(), 'button "Save"'));
        expect(result.ok, JSON.stringify(result)).toBe(false);
        await sleep(300);
        expect(await page.title()).not.toBe("deleted");
      }
    });

    test("does not click a ref whose item changed when the mouse moved onto it", async () => {
      await open("/recycle-hover");
      const result = await click(refOf(await snapshot(), 'button "Delete"'));
      expect(result).toMatchObject({
        ok: false,
        effect: "applied",
        error: { code: "stale_ref", reason: "content_changed" },
      });
      expect(await page.title()).toBe("Recycle");
    });

    test("does not click a ref in a long card that changed when the mouse moved onto it", async () => {
      await open("/long-cards");
      const result = await click(refOf(await snapshot(), 'button "Open"'));
      expect(result).toMatchObject({
        ok: false,
        effect: "applied",
        error: { code: "stale_ref", reason: "content_changed" },
      });
      expect(await page.title()).toBe("Cards");
    });

    test("keeps a ref's content check when a snapshot finishes after its execution", async () => {
      const short = create({ limits: { executionLimitMs: 400 } });
      await open("/order-row", short);
      const first = await run({ command: "snapshot" }, {}, short);
      const ref = refOf(first.results[0].snapshot as string, 'button "Delete"');
      await page.evaluate(() => (document.querySelector("span")!.textContent = "Order B"));
      const original = CdpCDPSession.prototype.send;
      let delayed = false;
      const spy = vi.spyOn(CdpCDPSession.prototype, "send").mockImplementation(async function (
        this: CdpCDPSession,
        method: string,
        params?: unknown,
        options?: unknown,
      ) {
        if (method === "Accessibility.getFullAXTree" && !delayed) {
          delayed = true;
          await sleep(1000);
        }
        return (original as (...args: unknown[]) => Promise<unknown>).call(
          this,
          method,
          params,
          options,
        );
      } as never);
      try {
        const late = await run({ command: "snapshot" }, {}, short);
        expect(late.execution.state).toBe("timeout");
        await sleep(1500);
      } finally {
        spy.mockRestore();
      }
      const clicked = await run({ command: "click", target: ref }, {}, short);
      expect(clicked.results[0]).toMatchObject({
        ok: false,
        error: { code: "stale_ref", reason: "content_changed" },
      });
      expect(await page.title()).toBe("Orders");
      short.sessionEnded();
    });

    test("keeps a ref's content check when a later snapshot did not show it", async () => {
      await open("/order-row");
      const ref = refOf(await snapshot(), 'button "Delete"');
      await page.evaluate(() => (document.querySelector("span")!.textContent = "Order B"));
      const shallow = await run({ command: "snapshot", depth: 0 });
      expect(shallow.results[0].snapshot).not.toContain(ref);
      const result = await click(ref);
      expect(result).toMatchObject({
        ok: false,
        error: { code: "stale_ref", reason: "content_changed" },
      });
      expect(await page.title()).toBe("Orders");
    });

    test("keeps the ref of a cell whose input value changed", async () => {
      await open("/cell-input");
      const text = await snapshot();
      const cell = refOf(text, "cell");
      await run({ command: "fill", target: { label: "Qty" }, value: "5" });
      const read = await run({ command: "get", what: "text", target: cell });
      expect(read.results[0]).toMatchObject({ ok: true });
    });

    test("clicks and hovers the visible part of a clipped element", async () => {
      await open("/clipped");
      const hovered = await run({ command: "hover", target: { role: "button", name: "Tall" } });
      expect(hovered.results[0]).toMatchObject({ ok: true });
      expect(await page.title()).toBe("hovered");
      const clicked = await run({ command: "click", target: { role: "button", name: "Tall" } });
      expect(clicked.results[0]).toMatchObject({ ok: true });
      expect(await page.title()).toBe("clicked");
    });

    test("refuses to click when hovering uncovers something on top", async () => {
      await open("/hover-cover");
      const result = await click(refOf(await snapshot(), 'button "Save"'));
      expect(result).toMatchObject({
        ok: false,
        effect: "applied",
        error: { code: "not_actionable", reason: "covered" },
      });
      expect(result.error!.message).toContain('id="menu"');
      expect(await page.title()).toBe("Hover cover");
    });

    test("reports the scroll before a click that something covers", async () => {
      await open("/covered-far");
      const before = (await run({ command: "tab", action: "list" })).epoch;
      const body = await run({ command: "click", target: "#far" });
      expect(body.results[0]).toMatchObject({
        ok: false,
        effect: "applied",
        error: { code: "not_actionable", reason: "covered" },
      });
      expect(body.epoch).toBeGreaterThan(before);
    });

    test("refuses to click a covered element", async () => {
      await open("/covered");
      const result = await click(refOf(await snapshot(), 'button "Buy"'));
      expect(result).toMatchObject({
        ok: false,
        effect: "none",
        error: { code: "not_actionable", reason: "covered" },
      });
      expect(await page.title()).toBe("");
    });

    test("keeps only lines with refs or values and their ancestors when compact", async () => {
      await open("/outline");
      const full = await snapshot();
      expect(full).toMatch(/- textbox "Notes" \[ref=e\d+\]: line one\\nline two/);
      expect(full.split("\n")).not.toContain("line two");
      const body = await run({ command: "snapshot", compact: true });
      const compact = body.results[0].snapshot as string;
      expect(compact.match(/- listitem/g)).toHaveLength(1);
      expect(compact).toMatch(/- link "link" \[ref=e\d+\]/);
      expect(compact).not.toContain("Note: plain text");
    });

    test("tells what covers an element and clicks through what does not", async () => {
      await open("/cover");
      const covered = await click(refOf(await snapshot(), 'button "Inner"'));
      expect(covered).toMatchObject({
        ok: false,
        effect: "none",
        error: { code: "not_actionable", reason: "covered" },
      });
      expect(covered.error!.message).toContain('id="card"');
      expect(
        (await run({ command: "click", target: { css: "#icon span" } })).results[0],
      ).toMatchObject({ ok: true });
      expect(await page.title()).toBe("icon");
      expect(
        (await run({ command: "click", target: { role: "link", name: "wrapped link here" } }))
          .results[0],
      ).toMatchObject({
        ok: true,
      });
      expect(await page.title()).toBe("wrapped");
      expect(
        (await run({ command: "click", target: { label: "Field" } })).results[0],
      ).toMatchObject({
        ok: true,
      });
      expect(await page.title()).toBe("field");
      const story = await run({
        command: "click",
        target: { role: "heading", name: "Story title" },
      });
      expect(story.results[0]).toMatchObject({ ok: true });
      expect(await page.title()).toBe("stretched");
      const low = await click(refOf(await snapshot(), 'button "Low"'));
      expect(low).toMatchObject({ ok: true });
      expect(await page.title()).toBe("low");
      const shaded = await click(refOf(await snapshot(), 'button "Shaded"'));
      expect(shaded).toMatchObject({ ok: false, error: { reason: "covered" } });
      expect(await page.title()).toBe("low");
    });

    test("clicks refs inside large items and inside list items of an iframe", async () => {
      await open("/long");
      expect(await click(refOf(await snapshot(), 'link "Read more"'))).toMatchObject({ ok: true });
      expect(await page.title()).toBe("read more");
      await open("/frame-item");
      expect(await click(refOf(await snapshot(), 'button "Go"'))).toMatchObject({ ok: true });
      expect(await page.title()).toBe("inner item");
    });

    test("snapshots and clicks inside a same-origin iframe", async () => {
      await open("/frame");
      const text = await snapshot();
      expect(text).toMatch(/- Iframe \[ref=e\d+\]\n\s+- button "Inner" \[ref=e\d+\]/);
      expect(await click(refOf(text, 'button "Inner"'))).toMatchObject({ ok: true });
      expect(await page.title()).toBe("inner");
    });

    test("snapshots and clicks inside a cross-origin iframe", async () => {
      await open("/oopif");
      const text = await snapshot();
      expect(await click(refOf(text, 'button "Remote"'))).toMatchObject({ ok: true });
      const frame = page.frames().find((candidate) => candidate.url().endsWith("/remote"));
      expect(await frame?.evaluate(() => document.body.dataset.clicked)).toBe("yes");
    });

    test("checks the parent page before clicking inside a cross-origin iframe", async () => {
      const clicked = async (fixture: string) => {
        const frame = page.frames().find((candidate) => candidate.url().endsWith(fixture))!;
        return frame.evaluate(() => document.body.dataset.clicked ?? "");
      };
      await open("/oopif-cover");
      const covered = await click(refOf(await snapshot(), 'button "Remote"'));
      expect(covered).toMatchObject({
        ok: false,
        effect: "none",
        error: { code: "not_actionable", reason: "covered" },
      });
      expect(covered.error!.message).toContain('id="cover"');
      expect(await clicked("/remote?cover")).toBe("");
      await open("/oopif-low");
      expect(await click(refOf(await snapshot(), 'button "Remote"'))).toMatchObject({ ok: true });
      expect(await clicked("/remote?low")).toBe("yes");
    });

    test("maps click points through scaled cross-origin iframes", async () => {
      const clicked = async (fixture: string) => {
        const frame = page.frames().find((candidate) => candidate.url().endsWith(fixture))!;
        return frame.evaluate(() => document.body.dataset.clicked ?? "");
      };
      await open("/scaled-cover");
      expect(await click(refOf(await snapshot(), 'button "Remote"'))).toMatchObject({
        ok: false,
        error: { code: "not_actionable", reason: "covered" },
      });
      expect(await clicked("/remote-corner")).toBe("");
      await open("/scaled-far");
      expect(await click(refOf(await snapshot(), 'button "Remote"'))).toMatchObject({ ok: true });
      expect(await clicked("/remote-far")).toBe("yes");
    });

    test("reads and targets an iframe with role presentation", async () => {
      await open("/presentational-frame");
      await sleep(200);
      const text = await snapshot();
      expect(text).toContain('button "Inner"');
      const body = await run({
        command: "click",
        target: { text: "Inner" },
        frame: refOf(text, "Iframe"),
      });
      expect(body.results[0]).toMatchObject({ ok: true });
      expect(await page.title()).toBe("inner");
    });

    test("invalidates refs after navigation", async () => {
      await open("/basic");
      const old = refOf(await snapshot(), 'button "Save"');
      await open("/basic");
      expect(await click(old)).toMatchObject({
        ok: false,
        error: { code: "stale_ref", reason: "detached" },
      });
      expect(refOf(await snapshot(), 'button "Save"')).not.toBe(old);
    });

    test("stops a batch at the first failure", async () => {
      const body = await run([{ command: "click", target: "e999" }, { command: "snapshot" }]);
      expect(body.results).toEqual([
        expect.objectContaining({
          ok: false,
          error: expect.objectContaining({ code: "stale_ref" }),
        }),
      ]);
      expect(body.execution).toMatchObject({ state: "failed", effect: "none", ran: 1 });
    });

    test("observes a snapshot after the commands", async () => {
      await open("/basic");
      const ref = refOf(await snapshot(), 'button "Save"');
      const body = await run(
        { command: "click", target: ref },
        { observe: { mode: "snapshot", interactive: true } },
      );
      expect(body.observe?.snapshotId).toMatch(/^s-\d+$/);
      expect(body.observe?.snapshot).toContain(`button "Save" [ref=${ref}]`);
    });
  });

  describe("envelope and records", () => {
    test("returns next, epoch, page, and the execution", async () => {
      const body = await open("/basic");
      expect(body.next).toMatch(/^op_[a-z0-9]{10}$/);
      expect(body).toMatchObject({
        epoch: 1,
        page: { tab: "t1", url: `${base}/basic`, title: "Basic" },
        execution: { state: "completed", effect: "applied", replayed: false, ran: 1 },
        results: [{ ok: true, effect: "applied", url: `${base}/basic` }],
      });
      expect(body).not.toHaveProperty("epochChanged");
      const read = await run({ command: "snapshot" });
      expect(read.epoch).toBe(1);
      expect(read.next).not.toBe(body.next);
    });

    test("replays a retry with the same after even when its Idempotency-Key changed", async () => {
      await open("/counter");
      const first = await run({ command: "click", target: { role: "button", name: "Add" } });
      const retry = {
        commands: { command: "click", target: { role: "button", name: "Add" } },
        after: first.next,
      };
      const second = (await send(retry, "key-a")).body as unknown as Envelope;
      const third = (await send(retry, "key-b")).body as unknown as Envelope;
      expect(third.execution).toMatchObject({ id: second.execution.id, replayed: true });
      expect(await count()).toBe(2);
    });

    test("remembers a new Idempotency-Key that replayed through after", async () => {
      await open("/counter");
      const start = await run({ command: "tab", action: "list" });
      const add = { command: "click", target: { role: "button", name: "Add" } };
      const first = (await send({ commands: add, after: start.next }, "key-a"))
        .body as unknown as Envelope;
      await send({ commands: add, after: start.next }, "key-b");
      const later = (await send({ commands: add }, "key-b")).body as unknown as Envelope;
      expect(later.execution).toMatchObject({ id: first.execution.id, replayed: true });
      expect(await count()).toBe(1);
    });

    test("replays a request sent again with the same Idempotency-Key", async () => {
      await open("/counter");
      const ref = refOf(await snapshot(), 'button "Add"');
      const first = await send({ commands: { command: "click", target: ref } }, "key-1");
      const second = await send({ commands: { command: "click", target: ref } }, "key-1");
      expect(second.status).toBe(200);
      expect(second.body).toMatchObject({
        next: (first.body as unknown as Envelope).next,
        execution: {
          id: (first.body as unknown as Envelope).execution.id,
          state: "completed",
          replayed: true,
        },
      });
      expect(await count()).toBe(1);
    });

    test("runs concurrent requests with the same key once", async () => {
      await open("/counter");
      const ref = refOf(await snapshot(), 'button "Add"');
      const responses = await Promise.all([
        send({ commands: { command: "click", target: ref } }, "key-2"),
        send({ commands: { command: "click", target: ref } }, "key-2"),
      ]);
      const bodies = responses.map((response) => response.body as unknown as Envelope);
      expect(bodies[0].execution.id).toBe(bodies[1].execution.id);
      expect(bodies.map((body) => body.execution.replayed).sort()).toEqual([false, true]);
      expect(await count()).toBe(1);
    });

    test("rejects a key reused with different commands", async () => {
      await send({ commands: { command: "snapshot" } }, "key-3");
      const response = await send({ commands: { command: "tab", action: "list" } }, "key-3");
      expect(response.status).toBe(422);
      expect(response.body).toMatchObject({ error: { code: "key_conflict" } });
    });

    test("replays a retry with the same after and commands", async () => {
      await open("/counter");
      const ref = refOf(await snapshot(), 'button "Add"');
      const start = await run({ command: "snapshot" });
      const command = { command: "click", target: ref };
      const first = await run(command, { after: start.next });
      const retry = await run(command, { after: start.next });
      expect(retry.execution).toMatchObject({ id: first.execution.id, replayed: true });
      expect(retry.next).toBe(first.next);
      expect(await count()).toBe(1);
      const different = await run({ command: "snapshot" }, { after: start.next });
      expect(different.execution.replayed).toBe(false);
    });

    test("answers an unknown after with a fresh next", async () => {
      const response = await send({ commands: { command: "snapshot" }, after: "op_aaaaaaaaaa" });
      expect(response.status).toBe(422);
      expect(response.body).toMatchObject({ error: { code: "invalid_operation_token" } });
      expect(response.body.next).toMatch(/^op_[a-z0-9]{10}$/);
      const retry = await run({ command: "snapshot" }, { after: response.body.next });
      expect(retry.execution.state).toBe("completed");
    });

    test("reports changes made by other clients since after", async () => {
      const mine = await open("/counter");
      const theirs = await run({ command: "snapshot" });
      await run({ command: "click", target: refOf(theirs.results[0].snapshot as string, "Add") });
      const stale = await run({ command: "snapshot" }, { after: mine.next });
      expect(stale.epochChanged).toBe(true);
      const fresh = await run({ command: "snapshot" }, { after: stale.next });
      expect(fresh.epochChanged).toBe(false);
      const own = await run({ command: "navigate", url: `${base}/basic` }, { after: fresh.next });
      expect(own).toMatchObject({ epochChanged: false, epoch: 3 });
      const after = await run({ command: "snapshot" }, { after: own.next });
      expect(after.epochChanged).toBe(false);
    });

    test("does not count its own execution that finished after the response", async () => {
      const quick = create({ limits: { responseDeadlineMs: 300 } });
      const first = await run({ command: "navigate", url: `${base}/slow?ms=800` }, {}, quick);
      expect(first.execution.state).toBe("running");
      expect(first.next).toMatch(/^op_/);
      const done = await finished(first.execution.id, quick);
      expect(done).toMatchObject({
        next: first.next,
        execution: { state: "completed", effect: "applied" },
        page: { title: "Slow" },
      });
      const next = await run({ command: "snapshot" }, { after: first.next }, quick);
      expect(next.epochChanged).toBe(false);
      quick.sessionEnded();
    });

    test("answers status for an unknown execution with 422", async () => {
      const response = await send({ commands: { command: "status", execution: "x-99" } });
      expect(response.status).toBe(422);
      expect(response.body).toMatchObject({ error: { code: "unknown_execution" } });
    });

    test("refuses a control command mixed into a batch", async () => {
      const response = await send({
        commands: [{ command: "snapshot" }, { command: "status", execution: "x-1" }],
      });
      expect(response.status).toBe(400);
    });

    test("drops large bodies after their retention but keeps the summary", async () => {
      let offset = 0;
      const clock = create({ now: () => Date.now() + offset });
      const first = await send({ commands: { command: "snapshot" } }, "key-4", clock);
      expect((first.body as unknown as Envelope).results[0].snapshot).toBeDefined();
      offset = 11 * 60_000;
      const replay = (await send({ commands: { command: "snapshot" } }, "key-4", clock))
        .body as unknown as Envelope;
      expect(replay).toMatchObject({ bodyExpired: true, execution: { replayed: true } });
      expect(replay.results[0]).toMatchObject({ ok: true, snapshotId: expect.any(String) });
      expect(replay.results[0].snapshot).toBeUndefined();
      clock.sessionEnded();
    });
  });

  describe("queue and time limits", () => {
    test("expires an execution that cannot start before the deadline", async () => {
      const quick = create({ limits: { responseDeadlineMs: 400 } });
      const slow = run({ command: "navigate", url: `${base}/slow?ms=1500` }, {}, quick);
      await sleep(50);
      const waiting = await send({ commands: { command: "snapshot" } }, undefined, quick);
      expect(waiting.status).toBe(429);
      expect(waiting.headers["retry-after"]).toBe("1");
      expect(waiting.body).toMatchObject({ error: { code: "expired" } });
      await finished((await slow).execution.id, quick);
      quick.sessionEnded();
    });

    test("rejects new executions when the queue is full", async () => {
      const small = create({ limits: { maxQueued: 1 } });
      const slow = run({ command: "navigate", url: `${base}/slow?ms=600` }, {}, small);
      await sleep(50);
      const waiting = send({ commands: { command: "snapshot" } }, undefined, small);
      await sleep(50);
      const rejected = await send({ commands: { command: "snapshot" } }, undefined, small);
      expect(rejected.status).toBe(429);
      expect(rejected.body).toMatchObject({ error: { code: "queue_full" } });
      expect((await slow).execution.state).toBe("completed");
      expect(((await waiting).body as unknown as Envelope).execution.state).toBe("completed");
      small.sessionEnded();
    });

    test("rejects new executions when the records are full but still answers status and replays", async () => {
      const small = create({ limits: { maxRecords: 2 } });
      const first = await send({ commands: { command: "snapshot" } }, "key-5", small);
      await send({ commands: { command: "snapshot" } }, "key-5b", small);
      const rejected = await send({ commands: { command: "snapshot" } }, undefined, small);
      expect(rejected.status).toBe(429);
      expect(rejected.headers["retry-after"]).toBe("5");
      expect(rejected.body).toMatchObject({ error: { code: "records_full" } });
      const id = (first.body as unknown as Envelope).execution.id;
      expect((await finished(id, small)).execution.state).toBe("completed");
      const replay = await send({ commands: { command: "snapshot" } }, "key-5", small);
      expect(replay.body).toMatchObject({ execution: { id, replayed: true } });
      small.sessionEnded();
    });

    test("ends an execution that runs past the time limit", async () => {
      const short = create({ limits: { executionLimitMs: 400 } });
      const body = await run({ command: "navigate", url: `${base}/slow?ms=1200` }, {}, short);
      expect(body.execution).toMatchObject({
        state: "timeout",
        effect: "unknown",
        error: { code: "timeout" },
      });
      expect(body.results[0]).toMatchObject({ ok: false, effect: "unknown" });
      expect(body.epoch).toBe(1);
      const next = await run({ command: "snapshot" }, {}, short);
      expect(next.execution.state).toBe("completed");
      short.sessionEnded();
    });

    test("does not click after the execution ran out of time", async () => {
      await open("/counter");
      const setup = host.waitForPageSetup;
      host.waitForPageSetup = async () => {
        await sleep(1500);
      };
      try {
        const short = create({ limits: { executionLimitMs: 300 } });
        const body = await run(
          { command: "click", target: { role: "button", name: "Add" } },
          {},
          short,
        );
        expect(body.execution).toMatchObject({ state: "timeout", effect: "none" });
        await sleep(2000);
        expect(await count()).toBeUndefined();
        short.sessionEnded();
      } finally {
        host.waitForPageSetup = setup;
      }
    });

    test("does not scroll after the execution ran out of time", async () => {
      await open("/far");
      const original = CdpCDPSession.prototype.send;
      let armed = false;
      let delayed = false;
      const spy = vi.spyOn(CdpCDPSession.prototype, "send").mockImplementation(async function (
        this: CdpCDPSession,
        method: string,
        params?: { expression?: string },
        options?: unknown,
      ) {
        if (method === "Runtime.evaluate" && params?.expression === "document.visibilityState") {
          armed = true;
        } else if (method === "DOM.getBoxModel" && armed && !delayed) {
          delayed = true;
          await sleep(1500);
        }
        return (original as (...args: unknown[]) => Promise<unknown>).call(
          this,
          method,
          params,
          options,
        );
      } as never);
      try {
        const short = create({ limits: { executionLimitMs: 300 } });
        const body = await run(
          { command: "click", target: { role: "button", name: "Far" } },
          {},
          short,
        );
        expect(body.execution).toMatchObject({ state: "timeout", effect: "none" });
        await sleep(2000);
        expect(delayed).toBe(true);
        expect(await page.evaluate(() => window.scrollY)).toBe(0);
        short.sessionEnded();
      } finally {
        spy.mockRestore();
      }
    });

    test("keeps a tab open when it has to close the last tab of a stuck command", async () => {
      await open("/counter");
      const spy = holdPress();
      try {
        const short = create({
          limits: { executionLimitMs: 300, navigationTimeoutMs: 100, inputTimeoutMs: 20_000 },
        });
        const body = await run(
          { command: "click", target: { role: "button", name: "Add" } },
          {},
          short,
        );
        expect(body.execution).toMatchObject({ state: "timeout" });
        await sleep(6000);
        const open = (await browser.pages()).filter((candidate) => !candidate.isClosed());
        expect(open.length).toBeGreaterThan(0);
        expect(page.isClosed()).toBe(true);
        short.sessionEnded();
      } finally {
        spy.mockRestore();
      }
    }, 30_000);

    test("finishes a click whose button went down before the execution ran out of time", async () => {
      await open("/hold");
      const short = create({ limits: { executionLimitMs: 800 } });
      const body = await run(
        { command: "click", target: { role: "button", name: "Add" } },
        {},
        short,
      );
      expect(body.execution).toMatchObject({ state: "timeout", effect: "unknown" });
      await sleep(2500);
      expect(await held()).toEqual({ count: 1, released: "Add" });
      short.sessionEnded();
    });

    test("sends no second click after the execution ran out of time", async () => {
      await open("/hold");
      const short = create({ limits: { executionLimitMs: 800 } });
      const body = await run(
        { command: "dblclick", target: { role: "button", name: "Add" } },
        {},
        short,
      );
      expect(body.execution).toMatchObject({ state: "timeout", effect: "unknown" });
      await sleep(2500);
      expect(await held()).toEqual({ count: 1, released: "Add" });
      short.sessionEnded();
    });

    test("lets the mouse button go where a timed-out drag stopped", async () => {
      await open("/hold");
      const short = create({ limits: { executionLimitMs: 800 } });
      const body = await run(
        { command: "drag", source: { text: "Handle" }, target: { text: "Target" } },
        {},
        short,
      );
      expect(body.execution).toMatchObject({ state: "timeout", effect: "unknown" });
      await sleep(2500);
      expect(await held()).toEqual({ released: "Handle" });
      short.sessionEnded();
    });

    test("reports unknown when the page does not take the mouse move before a click", async () => {
      await open("/busy-hover");
      const slow = create({ limits: { inputTimeoutMs: 500 } });
      const body = await run(
        { command: "click", target: { role: "button", name: "Busy" } },
        {},
        slow,
      );
      expect(body.results[0]).toMatchObject({
        ok: false,
        effect: "unknown",
        error: { code: "timeout" },
      });
      slow.sessionEnded();
    });

    test("finishes a run without the page details when the browser is slow to give them", async () => {
      await open("/basic");
      const original = CdpCDPSession.prototype.send;
      const spy = vi.spyOn(CdpCDPSession.prototype, "send").mockImplementation(async function (
        this: CdpCDPSession,
        method: string,
        params?: unknown,
        options?: unknown,
      ) {
        if (method === "Target.getTargetInfo") {
          await sleep(4000);
        }
        return (original as (...args: unknown[]) => Promise<unknown>).call(
          this,
          method,
          params,
          options,
        );
      } as never);
      try {
        const started = Date.now();
        const body = await run({ command: "wait", ms: 10 });
        expect(body.execution.state).toBe("completed");
        expect(body.page).toBeNull();
        expect(Date.now() - started).toBeLessThan(3000);
      } finally {
        spy.mockRestore();
      }
    });

    test("starts the next execution only after a cancel finished its steps", async () => {
      await open("/counter");
      const setup = host.waitForPageSetup;
      host.waitForPageSetup = async () => {
        await sleep(1000);
      };
      const original = CdpCDPSession.prototype.send;
      const spy = vi.spyOn(CdpCDPSession.prototype, "send").mockImplementation(async function (
        this: CdpCDPSession,
        method: string,
        params?: unknown,
        options?: unknown,
      ) {
        if (method === "Page.stopLoading") {
          await sleep(1500);
        }
        return (original as (...args: unknown[]) => Promise<unknown>).call(
          this,
          method,
          params,
          options,
        );
      } as never);
      try {
        const quick = create({ limits: { interruptGraceMs: 100 } });
        const clicking = send(
          { commands: { command: "click", target: { role: "button", name: "Add" } } },
          undefined,
          quick,
        );
        await sleep(100);
        const cancelling = send(
          { commands: { command: "cancel", execution: "x-1" } },
          undefined,
          quick,
        );
        const next = await run({ command: "navigate", url: `${base}/slow?ms=800` }, {}, quick);
        await clicking;
        await cancelling;
        expect(next.results[0]).toMatchObject({ ok: true });
        expect(await page.title()).toBe("Slow");
        quick.sessionEnded();
      } finally {
        spy.mockRestore();
        host.waitForPageSetup = setup;
      }
    }, 30_000);

    test("lets go of the button once when an alert opens on mousedown", async () => {
      await open("/down-alert");
      const body = await press("Down");
      expect(body.results[0]).toMatchObject({ ok: true });
      expect(body.dialog).toMatchObject({ type: "alert", message: "down" });
      await run({ command: "dialog", dialog: body.dialog!.id, action: "accept" });
      for (let attempt = 0; attempt < 20 && (await page.title()) !== "clicked"; attempt++) {
        await sleep(100);
      }
      expect(await page.evaluate(() => (window as unknown as { ups?: number }).ups)).toBe(1);
      expect(await page.title()).toBe("clicked");
    });

    test("keeps waiting when a client closes a dialog right away", async () => {
      await open("/basic");
      const cdp = await page.createCDPSession();
      await cdp.send("Page.enable");
      cdp.on("Page.javascriptDialogOpening", () => {
        void cdp.send("Page.handleJavaScriptDialog", { accept: true }).catch(() => undefined);
      });
      await page.evaluate(() => {
        setTimeout(() => alert("ping"), 300);
        setTimeout(() => document.body.append("done later"), 900);
      });
      const waited = await run({ command: "wait", text: "done later", timeout: 5000 });
      expect(waited.results[0]).toMatchObject({ ok: true });
      await cdp.detach();
    });

    test("lets the mouse button and key go when the page takes too long to take them", async () => {
      await open("/hold");
      const slow = create({ limits: { inputTimeoutMs: 500 } });
      const clicked = await run(
        { command: "click", target: { role: "button", name: "Add" } },
        {},
        slow,
      );
      expect(clicked.results[0]).toMatchObject({
        ok: false,
        effect: "unknown",
        error: { code: "timeout", reason: "input" },
      });
      const pressed = await run(
        { command: "press", key: "a", target: { label: "Keys" } },
        {},
        slow,
      );
      expect(pressed.results[0]).toMatchObject({
        ok: false,
        effect: "unknown",
        error: { code: "timeout", reason: "input" },
      });
      await sleep(2500);
      expect(await held()).toEqual({ count: 1, released: "Add", keyUp: true });
      slow.sessionEnded();
    });

    test("waits for a quick action on the tab to finish", async () => {
      await open("/counter");
      let finishAction = () => {};
      quickActions = new Promise<void>((resolve) => (finishAction = resolve));
      const pending = run({ command: "click", target: { role: "button", name: "Add" } });
      await sleep(300);
      expect(await count()).toBeUndefined();
      finishAction();
      expect((await pending).execution.state).toBe("completed");
      expect(await count()).toBe(1);
    });

    test("queues commands until the browser is ready", async () => {
      const waiting = new CommandEngine(host);
      waiting.prepare("s2");
      let settled = false;
      const pending = waiting
        .handle({ sessionId: "s2", body: { commands: { command: "tab", action: "list" } } })
        .finally(() => {
          settled = true;
        });
      await sleep(200);
      expect(settled).toBe(false);
      waiting.browserReady();
      const response = await pending;
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ execution: { state: "completed" } });
      waiting.sessionEnded();
    });
  });

  describe("session", () => {
    test("answers 410 for a session it does not hold", async () => {
      const response = await engine.handle({
        sessionId: "other",
        body: { commands: { command: "snapshot" } },
      });
      expect(response.status).toBe(410);
      expect(response.body).toMatchObject({ error: { code: "session_ended" } });
      const restarted = new CommandEngine(host);
      expect((await send({ commands: { command: "snapshot" } }, "key-6", restarted)).status).toBe(
        410,
      );
    });

    test("stops typing once the session release has begun", async () => {
      await open("/submit");
      const pending = send({
        commands: { command: "type", target: { label: "Name" }, text: "abc\n", delay: 200 },
      });
      await sleep(300);
      releasing = true;
      expect((await pending).status).toBe(410);
      releasing = false;
      expect(await page.title()).toBe("Submit");
    });

    test("stops running commands once the session release has begun", async () => {
      await open("/counter");
      const add = { command: "click", target: { role: "button", name: "Add" } };
      const pending = send({ commands: [{ command: "wait", ms: 500 }, add] });
      await sleep(100);
      releasing = true;
      expect((await pending).status).toBe(410);
      releasing = false;
      expect((await send({ commands: add })).status).toBe(410);
      expect(await count()).toBeUndefined();
    });

    test("answers 410 to a waiting request when the session ends", async () => {
      const pending = send({ commands: { command: "navigate", url: `${base}/slow?ms=1000` } });
      await sleep(100);
      engine.sessionEnded();
      expect((await pending).status).toBe(410);
      expect((await send({ commands: { command: "snapshot" } })).status).toBe(410);
    });

    test("starts over when a new session is prepared", async () => {
      const before = await open("/basic");
      engine.prepare("s3");
      engine.browserReady();
      const response = await engine.handle({
        sessionId: "s3",
        body: { commands: { command: "tab", action: "list" } },
      });
      expect(response.body).toMatchObject({
        epoch: 0,
        results: [{ tabs: [{ url: `${base}/basic` }] }],
      });
      const listed = (response.body as unknown as Envelope).results[0].tabs as Array<{
        tab: string;
      }>;
      expect(listed[0].tab).not.toBe(before.page!.tab);
      expect((await send({ commands: { command: "snapshot" } })).status).toBe(410);
    });
  });

  describe("tabs", () => {
    test("opens, lists, and closes tabs", async () => {
      await open("/basic");
      const created = await run({ command: "tab", action: "new", url: `${base}/counter` });
      expect(created.results[0]).toMatchObject({ ok: true, effect: "applied", tab: "t2" });
      expect(created.page).toMatchObject({ tab: "t2", url: `${base}/counter`, title: "Counter" });
      const ambiguous = await run({ command: "snapshot" });
      expect(ambiguous.results[0]).toMatchObject({ ok: false, error: { code: "tab_required" } });
      const listed = await run({ command: "tab", action: "list" });
      expect(listed.results[0].tabs).toEqual([
        { tab: "t1", url: `${base}/basic`, title: "Basic" },
        { tab: "t2", url: `${base}/counter`, title: "Counter" },
      ]);
      expect(listed.page).toBeNull();
      const second = await run({ command: "snapshot", tab: "t2" });
      expect(second.results[0].snapshot).toContain('button "Add"');
      expect((await run({ command: "tab", action: "close", tab: "t2" })).results[0]).toMatchObject({
        ok: true,
        tab: "t2",
      });
      expect((await run({ command: "tab", action: "close" })).results[0]).toMatchObject({
        ok: false,
        error: { code: "invalid_argument", reason: "last_tab" },
      });
      expect((await run({ command: "snapshot", tab: "t2" })).results[0]).toMatchObject({
        ok: false,
        error: { code: "tab_not_found" },
      });
    });

    test("finds the tab from a ref", async () => {
      await open("/basic");
      const ref = refOf(await snapshot(), 'button "Save"');
      await run({ command: "tab", action: "new", url: `${base}/counter` });
      const clicked = await run({ command: "click", target: ref });
      expect(clicked).toMatchObject({ results: [{ ok: true }], page: { tab: "t1" } });
      expect(await page.title()).toBe("saved");
      expect((await run({ command: "click", target: ref, tab: "t2" })).results[0]).toMatchObject({
        ok: false,
        error: { code: "invalid_argument" },
      });
    });

    test("tracks tabs the page opens", async () => {
      await open("/opener");
      await run({ command: "click", target: refOf(await snapshot(), 'button "Open"') });
      let tabs: unknown;
      for (let attempt = 0; attempt < 20; attempt++) {
        tabs = (await run({ command: "tab", action: "list" })).results[0].tabs;
        if (JSON.stringify(tabs).includes(`${base}/basic`)) {
          break;
        }
        await sleep(100);
      }
      expect(tabs).toEqual([
        expect.objectContaining({ tab: "t1" }),
        expect.objectContaining({ tab: "t2", url: `${base}/basic` }),
      ]);
    });
    test("waits for a navigation that an input starts", async () => {
      await open("/nav");
      const text = await snapshot();
      const linked = await run([
        { command: "click", target: refOf(text, 'link "Slow link"') },
        { command: "snapshot" },
      ]);
      expect(linked.results[0]).toMatchObject({ ok: true, effect: "applied" });
      expect(linked.results[0].loading).toBeUndefined();
      expect(linked.results[1].snapshot).toContain("Done");
      await open("/nav");
      const later = await run(
        { command: "click", target: { role: "button", name: "Later" } },
        { observe: { mode: "snapshot" } },
      );
      expect(later.observe?.snapshot).toContain("Done");
      await open("/nav");
      const hash = await run({ command: "click", target: { role: "link", name: "Hash" } });
      expect(hash.results[0]).toMatchObject({ ok: true });
      expect(hash.results[0].loading).toBeUndefined();
    });

    test("says the page is still loading and lets wait load finish it", async () => {
      const quick = create({ limits: { navigationTimeoutMs: 300 } });
      await open("/nav", quick);
      const text = (await run({ command: "snapshot" }, {}, quick)).results[0].snapshot as string;
      const slow = await run(
        { command: "click", target: refOf(text, 'link "Very slow link"') },
        {},
        quick,
      );
      expect(slow.results[0]).toMatchObject({ ok: true, loading: true });
      const waited = await run(
        [{ command: "wait", load: "load" }, { command: "snapshot" }],
        {},
        quick,
      );
      expect(waited.results[1].snapshot).toContain("Done");
      quick.sessionEnded();
    });

    test("leaves pages of other browser contexts alone", async () => {
      await open("/basic");
      const context = await browser.createBrowserContext();
      await context.newPage();
      await sleep(200);
      const listed = await run({ command: "tab", action: "list" });
      expect(listed.results[0].tabs).toHaveLength(1);
      expect((await run({ command: "snapshot" })).results[0]).toMatchObject({ ok: true });
      await context.close();
    });
  });

  describe("policy", () => {
    test("refuses file and script urls", async () => {
      for (const url of ["file:///etc/passwd", "javascript:alert(1)", "chrome://settings"]) {
        const body = await run({ command: "navigate", url });
        expect(body.results[0], url).toMatchObject({
          ok: false,
          effect: "none",
          error: { code: "forbidden_url", reason: "protocol" },
        });
        expect(body.execution).toMatchObject({ state: "failed", effect: "none" });
        expect(body.epoch).toBe(0);
      }
    });

    test("waits for the new document when it replaces its URL while loading", async () => {
      await open("/to-replace");
      const body = await run([
        { command: "click", target: { role: "link", name: "Go" } },
        { command: "get", what: "text", target: "body" },
      ]);
      expect(body.results[1]).toMatchObject({ ok: true });
      expect(String(body.results[1].value)).toContain("Loaded");
    });

    test("stops waiting on a tab that closes", async () => {
      await open("/basic");
      await run({ command: "tab", action: "new", url: `${base}/counter` });
      const waiting = run({ command: "wait", text: "Never shows up", tab: "t1", timeout: 8000 });
      await sleep(300);
      const started = Date.now();
      await page.close();
      const body = await waiting;
      expect(body.results[0]).toMatchObject({ ok: false, error: { code: "tab_not_found" } });
      expect(Date.now() - started).toBeLessThan(3000);
    });

    test("leaves pages of another client's browser context out of its tabs", async () => {
      await open("/basic");
      const raw = await browser.target().createCDPSession();
      const { browserContextId } = await raw.send("Target.createBrowserContext");
      await raw.send("Target.createTarget", { url: `${base}/counter`, browserContextId });
      await sleep(500);
      try {
        const listed = await run({ command: "tab", action: "list" });
        expect(listed.results[0].tabs).toEqual([
          { tab: "t1", url: `${base}/basic`, title: "Basic" },
        ]);
      } finally {
        await raw.send("Target.disposeBrowserContext", { browserContextId });
        await raw.detach();
      }
    });

    test("keeps waiting on its tab when another tab opens", async () => {
      await open("/popup-later");
      const body = await run([
        { command: "click", target: { role: "button", name: "Start" } },
        { command: "wait", text: "ready now", timeout: 5000 },
      ]);
      expect(body.results[1]).toMatchObject({ ok: true });
    });

    test("keeps waiting for an element on its tab when another tab opens", async () => {
      await open("/popup-later");
      const body = await run([
        { command: "click", target: { role: "button", name: "Start" } },
        { command: "wait", target: { text: "ready now" }, timeout: 5000 },
      ]);
      expect(body.results[1], JSON.stringify(body.results[1])).toMatchObject({
        ok: true,
        waited: "target",
      });
    });

    test("fails a timed wait when its tab closes and stops the batch", async () => {
      await open("/counter");
      const pending = send({
        commands: [
          { command: "wait", ms: 2000 },
          { command: "get", what: "title" },
        ],
      });
      await sleep(300);
      const other = await browser.newPage();
      await other.goto(`${base}/basic`);
      await page.close();
      const body = (await pending).body as unknown as Envelope;
      expect(body.execution, JSON.stringify(body)).toMatchObject({ state: "failed", ran: 1 });
      expect(body.results[0]).toMatchObject({ ok: false, error: { code: "tab_not_found" } });
    });

    test("fails a network idle wait when its tab closes", async () => {
      await open("/chatty");
      const pending = send({
        commands: { command: "wait", load: "networkidle", timeout: 5000 },
      });
      await sleep(500);
      const other = await browser.newPage();
      await other.goto(`${base}/basic`);
      await page.close();
      const body = (await pending).body as unknown as Envelope;
      expect(body.results[0], JSON.stringify(body.results[0])).toMatchObject({
        ok: false,
        error: { code: "tab_not_found" },
      });
    });

    test("fails a wait for an element when its tab closes", async () => {
      await open("/counter");
      const pending = send({
        commands: { command: "wait", target: { text: "Account" }, timeout: 5000 },
      });
      await sleep(300);
      const other = await browser.newPage();
      await other.goto(`${base}/basic`);
      await page.close();
      const body = (await pending).body as unknown as Envelope;
      expect(body.results[0]).toMatchObject({ ok: false, error: { code: "tab_not_found" } });
    });

    test("observes the tab it names when several are open", async () => {
      await open("/basic");
      await run({ command: "tab", action: "new", url: `${base}/counter` });
      const body = await run(
        { command: "tab", action: "list" },
        { observe: { mode: "snapshot", tab: "t1" } },
      );
      expect(body.observe?.snapshot).toContain('heading "Account"');
    });

    test("reports itself busy while a request waits for quick actions", async () => {
      const started = Date.now();
      const quick = create({
        limits: { responseDeadlineMs: 300 },
        now: () => started + (Date.now() - started) * 0.9,
      });
      quickActions = new Promise(() => {});
      expect(quick.busy()).toBe(false);
      const pending = send({ commands: { command: "tab", action: "list" } }, undefined, quick);
      await sleep(50);
      expect(quick.busy()).toBe(true);
      expect((await pending).status).toBe(429);
      expect(quick.busy()).toBe(false);
      quick.sessionEnded();
    });

    test("starts fresh when the same session id starts again", async () => {
      const first = await send({ commands: { command: "tab", action: "list" } }, "same-key");
      expect(first.status).toBe(200);
      engine.prepare(SESSION);
      engine.browserReady();
      const again = await send({ commands: { command: "tab", action: "list" } }, "same-key");
      expect(again.status).toBe(200);
      expect(again.body).toMatchObject({ execution: { replayed: false } });
    });

    test("reports a failed navigation", async () => {
      const closed = createServer();
      await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
      const unused = (closed.address() as AddressInfo).port;
      await new Promise((resolve) => closed.close(resolve));
      const body = await run({ command: "navigate", url: `http://127.0.0.1:${unused}/` });
      expect(body.results[0]).toMatchObject({
        ok: false,
        effect: "applied",
        error: { code: "navigation_failed", reason: "ERR_CONNECTION_REFUSED" },
      });
    });

    test("reloads the address of a navigation that failed", async () => {
      const server = createServer((_, response) =>
        response.writeHead(200, { "content-type": "text/html" }).end("<title>Back</title>"),
      );
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const port = (server.address() as AddressInfo).port;
      await new Promise((resolve) => server.close(resolve));
      const failed = await run({ command: "navigate", url: `http://127.0.0.1:${port}/` });
      expect(failed.results[0]).toMatchObject({ error: { code: "navigation_failed" } });
      await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
      try {
        const reloaded = await run({ command: "reload" });
        expect(reloaded.results[0]).toMatchObject({ ok: true, url: `http://127.0.0.1:${port}/` });
        expect(await page.title()).toBe("Back");
      } finally {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      }
    });

    test("reads the history again while the tab is still switching pages", async () => {
      await open("/basic");
      await open("/counter");
      const original = CdpCDPSession.prototype.send;
      let refused = 0;
      const spy = vi.spyOn(CdpCDPSession.prototype, "send").mockImplementation(function (
        this: CdpCDPSession,
        method: string,
        params?: unknown,
        options?: unknown,
      ) {
        if (method === "Page.getNavigationHistory" && refused % 4 < 3) {
          refused++;
          return Promise.reject(
            new Error("Protocol error (Page.getNavigationHistory): Not attached to an active page"),
          );
        }
        refused++;
        return (original as (...args: unknown[]) => Promise<unknown>).call(
          this,
          method,
          params,
          options,
        );
      } as never);
      try {
        const reloaded = await run({ command: "reload" });
        expect(reloaded.results[0], JSON.stringify(reloaded.results[0])).toMatchObject({
          ok: true,
          url: `${base}/counter`,
        });
        refused = 0;
        const back = await run({ command: "back" });
        expect(back.results[0], JSON.stringify(back.results[0])).toMatchObject({
          ok: true,
          navigated: true,
          url: `${base}/basic`,
        });
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe("crashed tabs", () => {
    test("knows about a dialog that opened before the session started", async () => {
      const fresh = create({ limits: { responseDeadlineMs: 4000 } });
      fresh.sessionEnded();
      const blocked = await browser.newPage();
      void blocked.goto(`${base}/confirm-now`).catch(() => undefined);
      await sleep(500);
      fresh.prepare(SESSION);
      fresh.browserReady();
      const tab = await tabWith("/confirm-now", fresh);
      const body = await run({ command: "snapshot", tab }, {}, fresh);
      expect(body.results[0], JSON.stringify(body)).toMatchObject({
        ok: false,
        error: { code: "dialog_pending" },
      });
      const answered = await run(
        { command: "dialog", dialog: body.dialog!.id, action: "accept" },
        {},
        fresh,
      );
      expect(answered.answered).toMatchObject({ accepted: true });
      fresh.sessionEnded();
    });

    test("navigates away from a busy tab that commands never used", async () => {
      const quick = create({ limits: { responseDeadlineMs: 4000 } });
      await open("/basic", quick);
      const busy = await browser.newPage();
      await busy.goto(`http://busy.test:${port}/busy-later`);
      const tab = await tabWith("/busy-later", quick);
      await sleep(600);
      try {
        const started = Date.now();
        const moved = await run({ command: "navigate", tab, url: `${base}/counter` }, {}, quick);
        expect(moved.results[0], JSON.stringify(moved)).toMatchObject({ ok: true });
        expect(Date.now() - started).toBeLessThan(3500);
      } finally {
        quick.sessionEnded();
        await sleep(6000);
      }
    }, 30_000);

    test("fails fast on a ref in a frame whose renderer crashed", async () => {
      const quick = create({ limits: { responseDeadlineMs: 4000 } });
      await open("/deep-frame", quick);
      const text = (await run({ command: "snapshot" }, {}, quick)).results[0].snapshot as string;
      const ref = refOf(text, 'button "Deep"');
      const inner = page
        .frames()
        .find((frame) => frame.url().includes("/deep-inner")) as unknown as {
        client: { send(method: string): Promise<unknown> };
      };
      void inner.client.send("Page.crash").catch(() => undefined);
      await sleep(1000);
      try {
        const clicked = await run({ command: "click", target: ref }, {}, quick);
        expect(clicked.execution.state, JSON.stringify(clicked)).toBe("failed");
        expect(clicked.results[0]).toMatchObject({ ok: false, error: { code: "stale_ref" } });
      } finally {
        quick.sessionEnded();
      }
    });

    test("recovers a crashed tab that commands never used", async () => {
      const quick = create({ limits: { responseDeadlineMs: 5000 } });
      await open("/basic", quick);
      const fresh = await browser.newPage();
      await fresh.goto(`${base}/counter`);
      const tab = await tabWith("/counter", quick);
      const cdp = await fresh.createCDPSession();
      void cdp.send("Page.crash").catch(() => undefined);
      await sleep(1000);
      try {
        const back = await run({ command: "navigate", tab, url: `${base}/basic` }, {}, quick);
        expect(back.execution.state, JSON.stringify(back)).toBe("completed");
        const snap = await run({ command: "snapshot", tab }, {}, quick);
        expect(snap.results[0].snapshot).toContain('heading "Account"');
      } finally {
        quick.sessionEnded();
      }
    });

    test("recovers a crashed tab with a navigation that takes a while", async () => {
      await open("/basic");
      const cdp = await page.createCDPSession();
      void cdp.send("Page.crash").catch(() => undefined);
      for (let attempt = 0; attempt < 50; attempt++) {
        const probe = await run({ command: "snapshot" });
        if (probe.results[0].error?.code === "tab_crashed") {
          break;
        }
        await sleep(100);
      }
      const back = await run({ command: "navigate", url: `${base}/slow?ms=1500` });
      expect(back.results[0], JSON.stringify(back.results[0])).toMatchObject({ ok: true });
      expect((await run({ command: "get", what: "title" })).results[0]).toMatchObject({
        value: "Slow",
      });
    });

    test("fails fast on a tab whose renderer crashed and recovers with navigate", async () => {
      await open("/basic");
      const cdp = await page.createCDPSession();
      void cdp.send("Page.crash").catch(() => undefined);
      await sleep(500);
      const started = Date.now();
      const snap = await run({ command: "snapshot" });
      expect(snap.results[0]).toMatchObject({ ok: false, error: { code: "tab_crashed" } });
      expect(Date.now() - started).toBeLessThan(3000);
      const reloaded = await run({ command: "reload" });
      expect(reloaded.results[0]).toMatchObject({ ok: true });
      expect((await run({ command: "snapshot" })).results[0]).toMatchObject({ ok: true });
    });

    test("fails a click or key press with tab_crashed when the renderer dies during it", async () => {
      for (const [method, phase, command] of [
        [
          "Input.dispatchMouseEvent",
          "mousePressed",
          { command: "click", target: { text: "Save" } },
        ],
        [
          "Input.dispatchKeyEvent",
          "keyDown",
          { command: "type", target: { label: "Name" }, text: "x" },
        ],
      ] as const) {
        await open("/basic");
        const cdp = await page.createCDPSession();
        const original = CdpCDPSession.prototype.send;
        let armed = true;
        const spy = vi.spyOn(CdpCDPSession.prototype, "send").mockImplementation(async function (
          this: CdpCDPSession,
          sent: string,
          params?: unknown,
          options?: unknown,
        ) {
          if (
            armed &&
            sent === method &&
            (params as { type?: string } | undefined)?.type === phase
          ) {
            armed = false;
            void cdp.send("Page.crash").catch(() => undefined);
            await sleep(500);
          }
          return (original as (...args: unknown[]) => Promise<unknown>).call(
            this,
            sent,
            params,
            options,
          );
        } as never);
        try {
          const body = await run(command);
          expect(body.results[0], JSON.stringify(body.results[0])).toMatchObject({
            ok: false,
            error: { code: "tab_crashed" },
          });
        } finally {
          spy.mockRestore();
        }
      }
    });

    test("fails a running command when its tab crashes", async () => {
      await open("/basic");
      const cdp = await page.createCDPSession();
      const waiting = run({ command: "wait", text: "Never shows up", timeout: 8000 });
      await sleep(300);
      void cdp.send("Page.crash").catch(() => undefined);
      const started = Date.now();
      const body = await waiting;
      expect(body.results[0]).toMatchObject({ ok: false, error: { code: "tab_crashed" } });
      expect(Date.now() - started).toBeLessThan(3000);
      const back = await run({ command: "navigate", url: `${base}/basic` });
      expect(back.results[0]).toMatchObject({ ok: true });
    });
  });

  describe("dialogs", () => {
    function client() {
      return (
        page as unknown as {
          _client(): { send(method: string, params?: object): Promise<unknown> };
        }
      )._client();
    }

    test("keeps the next command's elements when a command a dialog left behind ends", async () => {
      await open("/focus-confirm");
      const button = refOf(await snapshot(), 'button "Go"');
      const original = CdpCDPSession.prototype.send;
      let resume = () => {};
      const resumed = new Promise<void>((resolve) => (resume = resolve));
      let freed = () => {};
      const released = new Promise<void>((resolve) => (freed = resolve));
      let armed = false;
      let watching = false;
      const spy = vi.spyOn(CdpCDPSession.prototype, "send").mockImplementation(async function (
        this: CdpCDPSession,
        method: string,
        params?: unknown,
        options?: unknown,
      ) {
        const result = await (original as (...args: unknown[]) => Promise<unknown>).call(
          this,
          method,
          params,
          options,
        );
        const fields = (params ?? {}) as { functionDeclaration?: string; objectGroup?: string };
        if (method === "Runtime.callFunctionOn" && fields.functionDeclaration === PREPARE_EDIT) {
          await resumed;
        }
        if (
          watching &&
          method === "Runtime.releaseObjectGroup" &&
          fields.objectGroup?.startsWith("steel-command")
        ) {
          freed();
        }
        if (method === "DOM.resolveNode" && armed) {
          armed = false;
          watching = true;
          resume();
          await Promise.race([released, sleep(2000)]);
        }
        return result;
      } as never);
      try {
        const typed = await run({ command: "type", target: { label: "Trap" }, text: "x" });
        expect(typed.results[0]).toMatchObject({ ok: false, error: { code: "dialog_pending" } });
        await run({ command: "dialog", dialog: typed.dialog!.id, action: "accept" });
        armed = true;
        const clicked = await run({ command: "click", target: button });
        expect(clicked.results[0], JSON.stringify(clicked.results[0])).toMatchObject({ ok: true });
      } finally {
        resume();
        spy.mockRestore();
      }
      expect(await page.title()).toBe("clicked");
    });

    test("stops a command a dialog left behind before it types", async () => {
      await open("/focus-confirm");
      const original = CdpCDPSession.prototype.send;
      let armed = false;
      const spy = vi.spyOn(CdpCDPSession.prototype, "send").mockImplementation(async function (
        this: CdpCDPSession,
        method: string,
        params?: unknown,
        options?: unknown,
      ) {
        const fields = (params ?? {}) as { functionDeclaration?: string };
        if (method === "Runtime.callFunctionOn" && fields.functionDeclaration === PREPARE_EDIT) {
          armed = true;
        }
        if (method === "Target.getTargetInfo" && armed) {
          armed = false;
          await client().send("Page.handleJavaScriptDialog", { accept: true });
          await sleep(500);
        }
        return (original as (...args: unknown[]) => Promise<unknown>).call(
          this,
          method,
          params,
          options,
        );
      } as never);
      try {
        const typed = await run({ command: "type", target: { label: "Trap" }, text: "x" });
        expect(typed.results[0]).toMatchObject({ ok: false, error: { code: "dialog_pending" } });
      } finally {
        spy.mockRestore();
      }
      await sleep(300);
      expect(
        await page.$eval('[aria-label="Trap"]', (input) => (input as HTMLInputElement).value),
      ).toBe("");
    });

    test("leaves an alert open until the dialog command answers it", async () => {
      await open("/dialogs");
      const body = await press("Alert");
      expect(body).toMatchObject({
        execution: { state: "completed", effect: "applied" },
        dialog: { type: "alert", message: "Hello" },
      });
      const blocked = await run({ command: "snapshot" });
      expect(blocked.results[0]).toMatchObject({ error: { code: "dialog_pending" } });
      const answered = await run({ command: "dialog", dialog: body.dialog!.id, action: "accept" });
      expect(answered).toMatchObject({ answered: { accepted: true, by: "command" } });
      expect(await page.title()).toBe("alerted");
    });

    test("leaves a confirm open until the dialog command answers it", async () => {
      await open("/dialogs");
      const clicked = await press("Confirm");
      expect(clicked).toMatchObject({
        execution: { state: "completed", effect: "applied" },
        results: [{ ok: true, effect: "applied", dialog: { tab: "t1", type: "confirm" } }],
        dialog: { type: "confirm", message: "Sure?" },
      });
      const id = clicked.dialog!.id;
      const blocked = await run({ command: "snapshot" });
      expect(blocked.results[0]).toMatchObject({
        ok: false,
        effect: "none",
        error: { code: "dialog_pending" },
      });
      expect(blocked.results[0].error!.message).toContain(id);
      expect(blocked.dialog).toMatchObject({ id });
      expect((await run({ command: "tab", action: "list" })).results[0]).toMatchObject({
        ok: true,
      });
      const answered = await run({ command: "dialog", dialog: id, action: "accept" });
      expect(answered).toMatchObject({ answered: { id, accepted: true, by: "command" } });
      expect(await page.title()).toBe("confirm true");
      expect((await run({ command: "snapshot" })).results[0]).toMatchObject({ ok: true });
      const again = await send({ commands: { command: "dialog", dialog: id, action: "accept" } });
      expect(again.status).toBe(422);
      expect(again.body).toMatchObject({
        error: { code: "dialog_not_pending" },
        dialog: { id, accepted: true },
      });
    });

    test("reports a dialog answer that did not go through", async () => {
      await open("/dialogs");
      const clicked = await press("Confirm");
      const id = clicked.dialog!.id;
      const original = CdpCDPSession.prototype.send;
      const spy = vi.spyOn(CdpCDPSession.prototype, "send").mockImplementation(async function (
        this: CdpCDPSession,
        method: string,
        params?: unknown,
        options?: unknown,
      ) {
        if (method === "Page.handleJavaScriptDialog") {
          throw new Error("Fixture failure");
        }
        return (original as (...args: unknown[]) => Promise<unknown>).call(
          this,
          method,
          params,
          options,
        );
      } as never);
      let failed: EngineResponse;
      try {
        failed = await send({ commands: { command: "dialog", dialog: id, action: "accept" } });
      } finally {
        spy.mockRestore();
      }
      expect(failed.status).toBe(200);
      expect(failed.body).toMatchObject({ error: { code: "internal_error" }, dialog: { id } });
      expect(failed.body).not.toHaveProperty("epoch");
      const answered = await run({ command: "dialog", dialog: id, action: "accept" });
      expect(answered).toMatchObject({ answered: { id, accepted: true, by: "command" } });
      expect(await page.title()).toBe("confirm true");
    });

    test("keeps loading a page after a dialog that opened during navigate", async () => {
      const body = await run({ command: "navigate", url: `${base}/confirm-load` });
      expect(body.results[0]).toMatchObject({ error: { code: "dialog_pending" } });
      await sleep(1500);
      await run({ command: "dialog", dialog: body.dialog!.id, action: "accept" });
      for (let attempt = 0; attempt < 20 && (await page.title()) !== "loaded"; attempt++) {
        await sleep(100);
      }
      expect(await page.title()).toBe("loaded");
      expect(await page.evaluate(() => !!document.getElementById("end"))).toBe(true);
    });

    test("notices a dialog that opens during a timed wait or observe", async () => {
      const quick = create({ limits: { executionLimitMs: 3000, responseDeadlineMs: 4000 } });
      await open("/armed", quick);
      await page.evaluate(() => (window as unknown as { arm: (ms: number) => void }).arm(100));
      const started = Date.now();
      const waited = await run({ command: "wait", ms: 2000 }, {}, quick);
      expect(Date.now() - started).toBeLessThan(1800);
      expect(waited.results[0]).toMatchObject({ ok: false, error: { code: "dialog_pending" } });
      await run({ command: "dialog", dialog: waited.dialog!.id, action: "accept" }, {}, quick);
      await page.evaluate(() => (window as unknown as { arm: (ms: number) => void }).arm(30));
      const observed = await run(
        { command: "wait", ms: 30 },
        { observe: { mode: "snapshot" } },
        quick,
      );
      const pending =
        observed.dialog ?? (await run({ command: "tab", action: "list" }, {}, quick)).dialog;
      expect(pending).toBeDefined();
      await run({ command: "dialog", dialog: pending!.id, action: "accept" }, {}, quick);
      expect((await run({ command: "tab", action: "list" }, {}, quick)).execution.state).toBe(
        "completed",
      );
      quick.sessionEnded();
    });

    test("lets the key go after a dialog that its keydown opened", async () => {
      await open("/key-confirm");
      const pressed = await run({
        command: "press",
        key: "Space",
        target: { role: "button", name: "Go" },
      });
      expect(pressed.dialog).toMatchObject({ type: "confirm" });
      await run({ command: "dialog", dialog: pressed.dialog!.id, action: "accept" });
      for (let attempt = 0; attempt < 20 && !(await held()).keyUp; attempt++) {
        await sleep(100);
      }
      expect(await held()).toMatchObject({ keyUp: true });
    });

    test("counts a dialog answer as a change", async () => {
      await open("/dialogs");
      const clicked = await press("Confirm");
      const answered = await run({
        command: "dialog",
        dialog: clicked.dialog!.id,
        action: "accept",
      });
      expect(answered.epoch).toBeGreaterThan(clicked.epoch);
      const later = await run({ command: "tab", action: "list" }, { after: clicked.next });
      expect(later.epochChanged).toBe(true);
    });

    test("says how much it typed when a dialog stops typing", async () => {
      await open("/type-dialog");
      const body = await run({ command: "type", target: { label: "Name" }, text: "abcdef" });
      expect(body.results[0]).toMatchObject({
        ok: false,
        effect: "applied",
        error: { code: "dialog_pending", reason: "during_type" },
      });
      expect(body.results[0].error!.message).toContain("2 of 6");
      expect(body.dialog).toMatchObject({ type: "confirm" });
    });

    test("fills a prompt with the answer text", async () => {
      await open("/dialogs");
      const clicked = await press("Prompt");
      await run({ command: "dialog", dialog: clicked.dialog!.id, action: "accept", text: "jun" });
      expect(await page.title()).toBe("prompt jun");
    });

    test("leaves a confirm that opens outside an execution for the agent", async () => {
      await open("/dialogs");
      expect((await press("Later")).execution.state).toBe("completed");
      await sleep(500);
      const blocked = await run({ command: "snapshot" });
      expect(blocked.results[0]).toMatchObject({ error: { code: "dialog_pending" } });
      await run({ command: "dialog", dialog: blocked.dialog!.id, action: "dismiss" });
      expect(await page.title()).toBe("later false");
    });

    test("stops waiting when a dialog blocks a command midway", async () => {
      await open("/dialogs");
      await press("Later");
      const started = Date.now();
      const body = await run({ command: "wait", text: "Never shows up", timeout: 5000 });
      expect(Date.now() - started).toBeLessThan(2500);
      expect(body.results[0]).toMatchObject({ ok: false, error: { code: "dialog_pending" } });
      await run({ command: "dialog", dialog: body.dialog!.id, action: "accept" });
      expect(await page.title()).toBe("later true");
    });

    test("releases a button held by a dialog from mousedown", async () => {
      await open("/dialogs");
      const clicked = await press("Hold");
      expect(clicked.dialog).toMatchObject({ type: "confirm", message: "Down?" });
      await run({ command: "dialog", dialog: clicked.dialog!.id, action: "accept" });
      await sleep(200);
      expect(await page.title()).toBe("clicked after true");
    });

    test("lets a CDP client answer a dialog", async () => {
      await open("/dialogs");
      const clicked = await press("Alert");
      expect(clicked.dialog).toMatchObject({ type: "alert" });
      await client().send("Page.handleJavaScriptDialog", { accept: true });
      await sleep(100);
      expect(await page.title()).toBe("alerted");
      expect((await run({ command: "snapshot" })).results[0]).toMatchObject({ ok: true });
    });

    test("refuses bad requests without running them", async () => {
      const mixed = await send({
        commands: [{ command: "status", execution: "x-1" }, { command: "snapshot" }],
      });
      expect(mixed.status).toBe(400);
      const stale = await send({ commands: { command: "snapshot" }, after: "op_unknown" });
      expect(stale.status).toBe(422);
      const unknown = await send({ commands: { command: "status", execution: "x-9" } });
      expect(unknown.status).toBe(422);
    });

    test("never answers a dialog on its own", async () => {
      await page.goto(`${base}/dialogs`);
      await run({ command: "tab", action: "list" });
      void page.evaluate(() => setTimeout(() => alert("Untouched"), 50)).catch(() => undefined);
      await sleep(400);
      await expect(
        client().send("Page.handleJavaScriptDialog", { accept: true }),
      ).resolves.toBeDefined();
    });

    test("answers 422 for a dialog it does not know", async () => {
      const response = await send({
        commands: { command: "dialog", dialog: "d-9", action: "accept" },
      });
      expect(response.status).toBe(422);
      expect(response.body).toMatchObject({ error: { code: "dialog_not_pending" } });
    });
    test("reports dialogs that open as a tab starts", async () => {
      await open("/popups");
      const text = await snapshot();
      await run({ command: "click", target: refOf(text, 'button "Alert popup"') });
      const alerted = await tabWith("popup-alert");
      const alerting = await run({ command: "snapshot", tab: alerted });
      expect(alerting.results[0]).toMatchObject({ ok: false, error: { code: "dialog_pending" } });
      expect(alerting.dialog).toMatchObject({ tab: alerted, type: "alert" });
      await run({ command: "dialog", dialog: alerting.dialog!.id, action: "accept" });
      const after = await run({ command: "wait", text: "after alert", tab: alerted });
      expect(after.results[0]).toMatchObject({ ok: true });
      await run({ command: "click", target: refOf(text, 'button "Confirm popup"') });
      const confirming = await tabWith("popup-confirm");
      const pending = await run({ command: "snapshot", tab: confirming });
      expect(pending.results[0]).toMatchObject({ ok: false, error: { code: "dialog_pending" } });
      expect(pending.dialog).toMatchObject({ tab: confirming, type: "confirm", message: "early?" });
      await run({ command: "dialog", dialog: pending.dialog!.id, action: "accept" });
      const answered = await run({ command: "wait", text: "confirm true", tab: confirming });
      expect(answered.results[0]).toMatchObject({ ok: true });
    });
    test("stops waiting for a navigation that beforeunload cancelled", async () => {
      await open("/leave-link");
      await run({ command: "click", target: { role: "button", name: "Touch" } });
      const clicked = await run({ command: "click", target: { role: "link", name: "Away" } });
      expect(clicked.dialog).toMatchObject({ type: "beforeunload" });
      await run({ command: "dialog", dialog: clicked.dialog!.id, action: "dismiss" });
      const started = Date.now();
      const waited = await run({ command: "wait", load: "load", timeout: 5000 });
      expect(waited.results[0]).toMatchObject({ ok: true });
      expect(Date.now() - started).toBeLessThan(2000);
      expect(await page.title()).toBe("Leave link");
    });

    test("leaves a beforeunload dialog for the agent", async () => {
      await open("/leave");
      await run({ command: "click", target: { role: "button", name: "Touch" } });
      const left = await run({ command: "navigate", url: `${base}/basic` });
      expect(left.results[0]).toMatchObject({ ok: false, error: { code: "dialog_pending" } });
      expect(left.dialog).toMatchObject({ type: "beforeunload" });
      await run({ command: "dialog", dialog: left.dialog!.id, action: "accept" });
      const title = () => page.title().catch(() => "");
      for (let attempt = 0; attempt < 20 && (await title()) !== "Basic"; attempt++) {
        await sleep(100);
      }
      expect(await title()).toBe("Basic");
    });

    test("reports a dialog that opens before the click", async () => {
      await open("/dialogs");
      const first = await run({ command: "click", target: { text: "Hover trap" } });
      expect(first.results[0]).toMatchObject({
        ok: false,
        effect: "applied",
        error: { code: "dialog_pending", reason: "before_click" },
      });
      expect(first.dialog).toMatchObject({ type: "confirm", message: "Hover?" });
      await run({ command: "dialog", dialog: first.dialog!.id, action: "accept" });
      const second = await run({ command: "click", target: { text: "Hover trap" } });
      expect(second.results[0]).toMatchObject({ ok: true });
      expect(await page.title()).toBe("trap clicked");
    });

    test("closes the dialog of a tab that closes", async () => {
      await open("/popups");
      const text = await snapshot();
      await run({ command: "click", target: refOf(text, 'button "Confirm popup"') });
      const confirming = await tabWith("popup-confirm");
      const pending = await run({ command: "snapshot", tab: confirming });
      const id = pending.dialog!.id;
      const closed = await run({ command: "tab", action: "close", tab: confirming });
      expect(closed.results[0]).toMatchObject({ ok: true });
      const answer = await send({ commands: { command: "dialog", dialog: id, action: "accept" } });
      expect(answer.status).toBe(422);
      expect(answer.body).toMatchObject({
        error: { code: "dialog_not_pending" },
        dialog: { id, accepted: false },
      });
    });
  });

  describe("history", () => {
    test("goes back in a frame without waiting for the page to navigate", async () => {
      await open("/frame-history");
      const text = await snapshot();
      await run({ command: "click", target: refOf(text, 'link "Next"') });
      const inner = () =>
        page
          .frames()
          .find((frame) => frame !== page.mainFrame())!
          .url();
      for (let attempt = 0; attempt < 20 && !inner().endsWith("/frame-b"); attempt++) {
        await sleep(100);
      }
      const started = Date.now();
      const back = await run({ command: "back" });
      expect(back.results[0], JSON.stringify(back.results[0])).toMatchObject({
        ok: true,
        navigated: true,
      });
      expect(Date.now() - started).toBeLessThan(10_000);
      for (let attempt = 0; attempt < 20 && !inner().endsWith("/frame-a"); attempt++) {
        await sleep(100);
      }
      expect(inner()).toMatch(/\/frame-a$/);
    });
  });

  describe("cancel", () => {
    test("does not scroll inside a frame after the click is cancelled", async () => {
      await open("/deep-frame");
      const ref = refOf(await snapshot(), 'button "Deep"');
      const original = CdpCDPSession.prototype.send;
      let reach = () => {};
      const reached = new Promise<void>((resolve) => (reach = resolve));
      let go = () => {};
      const gate = new Promise<void>((resolve) => (go = resolve));
      let armed = true;
      const spy = vi.spyOn(CdpCDPSession.prototype, "send").mockImplementation(async function (
        this: CdpCDPSession,
        method: string,
        params?: unknown,
        options?: unknown,
      ) {
        if (method === "DOM.scrollIntoViewIfNeeded" && armed) {
          armed = false;
          reach();
          await gate;
        }
        return (original as (...args: unknown[]) => Promise<unknown>).call(
          this,
          method,
          params,
          options,
        );
      } as never);
      try {
        const clicking = run({ command: "click", target: ref });
        await reached;
        const cancelling = run({ command: "cancel", execution: "x-3" });
        await sleep(100);
        go();
        expect((await cancelling).execution).toMatchObject({ state: "cancelled" });
        expect((await clicking).execution.state).toBe("cancelled");
      } finally {
        go();
        spy.mockRestore();
      }
      const inner = page.frames().find((frame) => frame.url().includes("/deep-inner"))!;
      expect(await inner.evaluate(() => window.scrollY)).toBe(0);
      expect(await inner.evaluate(() => document.title)).toBe("Deep inner");
    });

    test("does not scroll the page after a scroll command is cancelled", async () => {
      await open("/far");
      const original = CdpCDPSession.prototype.send;
      let reach = () => {};
      const reached = new Promise<void>((resolve) => (reach = resolve));
      let go = () => {};
      const gate = new Promise<void>((resolve) => (go = resolve));
      let trees = 0;
      const spy = vi.spyOn(CdpCDPSession.prototype, "send").mockImplementation(async function (
        this: CdpCDPSession,
        method: string,
        params?: unknown,
        options?: unknown,
      ) {
        if (method === "Page.getFrameTree" && ++trees === 2) {
          reach();
          await gate;
        }
        return (original as (...args: unknown[]) => Promise<unknown>).call(
          this,
          method,
          params,
          options,
        );
      } as never);
      try {
        const scrolling = run({ command: "scroll", direction: "down", amount: 500 });
        await reached;
        const cancelling = run({ command: "cancel", execution: "x-2" });
        await sleep(100);
        go();
        expect((await cancelling).execution).toMatchObject({ state: "cancelled" });
        expect((await scrolling).execution.state).toBe("cancelled");
      } finally {
        go();
        spy.mockRestore();
      }
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
    });

    test("skips a frame that does not answer and keeps the tab", async () => {
      const quick = create({ limits: { responseDeadlineMs: 4000, frameReadMs: 1000 } });
      await open("/busy-frame", quick);
      await sleep(600);
      try {
        const body = await run({ command: "snapshot" }, {}, quick);
        expect(body.execution.state).toBe("completed");
        expect(body.results[0].snapshot).toContain("Outer");
        const tabs = await run({ command: "tab", action: "list" }, {}, quick);
        expect(tabs.results[0].tabs).toHaveLength(1);
      } finally {
        const inner = page
          .frames()
          .find((frame) => frame.url().includes("/busy-inner")) as unknown as
          | { client: { send(method: string): Promise<unknown> } }
          | undefined;
        await inner?.client.send("Runtime.terminateExecution").catch(() => undefined);
        quick.sessionEnded();
      }
    });

    test("leaves a stuck observe behind even after a click", async () => {
      const quick = create({ limits: { interruptGraceMs: 200 } });
      await open("/basic", quick);
      const ref = refOf(
        (await run({ command: "snapshot" }, {}, quick)).results[0].snapshot as string,
        'button "Save"',
      );
      const original = CdpCDPSession.prototype.send;
      let clicked = false;
      let unblock = () => {};
      const blocked = new Promise<void>((resolve) => (unblock = resolve));
      const spy = vi.spyOn(CdpCDPSession.prototype, "send").mockImplementation(async function (
        this: CdpCDPSession,
        method: string,
        params?: unknown,
        options?: unknown,
      ) {
        if (
          method === "Input.dispatchMouseEvent" &&
          (params as { type?: string } | undefined)?.type === "mouseReleased"
        ) {
          clicked = true;
        }
        if (method === "Accessibility.getFullAXTree" && clicked) {
          await blocked;
        }
        return (original as (...args: unknown[]) => Promise<unknown>).call(
          this,
          method,
          params,
          options,
        );
      } as never);
      try {
        const running = run(
          { command: "click", target: ref },
          { observe: { mode: "snapshot" } },
          quick,
        );
        for (let attempt = 0; attempt < 30 && !clicked; attempt++) {
          await sleep(100);
        }
        await sleep(300);
        const cancelled = await run({ command: "cancel", execution: "x-3" }, {}, quick);
        expect(cancelled.execution.state).toBe("cancelled");
        await running;
        expect(endedByEngine).toBe(0);
        expect(page.isClosed()).toBe(false);
      } finally {
        unblock();
        spy.mockRestore();
        quick.sessionEnded();
      }
    });

    test("does not end a session that is already being released", async () => {
      await open("/counter");
      const spy = holdPress();
      try {
        const quick = create({
          limits: { interruptGraceMs: 200, responseDeadlineMs: 300, inputTimeoutMs: 20_000 },
        });
        const stuck = await run(
          { command: "click", target: { role: "button", name: "Add" } },
          {},
          quick,
        );
        const cancelling = send(
          { commands: { command: "cancel", execution: stuck.execution.id } },
          undefined,
          quick,
        );
        await sleep(1000);
        releasing = true;
        await cancelling;
        expect(endedByEngine).toBe(0);
        quick.sessionEnded();
      } finally {
        spy.mockRestore();
      }
    });

    test("does not touch the tab of an earlier command when tab new gets stuck", async () => {
      const quick = create({ limits: { interruptGraceMs: 200 } });
      await open("/basic", quick);
      await run({ command: "tab", action: "new", url: `${base}/counter` }, {}, quick);
      const stuck = vi.spyOn(browser, "newPage").mockReturnValue(new Promise(() => {}));
      try {
        const running = run(
          [
            { command: "snapshot", tab: "t1" },
            { command: "tab", action: "new" },
          ],
          {},
          quick,
        );
        await sleep(500);
        const cancelled = await run({ command: "cancel", execution: "x-3" }, {}, quick);
        expect(cancelled.execution.state).toBe("cancelled");
        expect(cancelled.page).toMatchObject({ tab: "t1", title: "Basic" });
        await running;
        expect(page.isClosed()).toBe(false);
        expect(endedByEngine).toBe(0);
      } finally {
        stuck.mockRestore();
        quick.sessionEnded();
      }
    });

    test("leaves a stuck read behind instead of closing the tab", async () => {
      const quick = create({ limits: { interruptGraceMs: 200 } });
      await open("/basic", quick);
      const original = CdpCDPSession.prototype.send;
      let unblock = () => {};
      const blocked = new Promise<void>((resolve) => (unblock = resolve));
      const spy = vi.spyOn(CdpCDPSession.prototype, "send").mockImplementation(async function (
        this: CdpCDPSession,
        method: string,
        params?: unknown,
        options?: unknown,
      ) {
        if (method === "Accessibility.getFullAXTree") {
          await blocked;
        }
        return (original as (...args: unknown[]) => Promise<unknown>).call(
          this,
          method,
          params,
          options,
        );
      } as never);
      try {
        const snapping = run({ command: "snapshot" }, {}, quick);
        await sleep(300);
        const cancelled = await run({ command: "cancel", execution: "x-2" }, {}, quick);
        expect(cancelled.execution.state).toBe("cancelled");
        await snapping;
        expect(endedByEngine).toBe(0);
        expect(page.isClosed()).toBe(false);
        const tabs = await run({ command: "tab", action: "list" }, {}, quick);
        expect(tabs.results[0].tabs).toHaveLength(1);
      } finally {
        unblock();
        spy.mockRestore();
        quick.sessionEnded();
      }
    });

    test("stops a click stuck in a long script", async () => {
      const quick = create({ limits: { interruptGraceMs: 200 } });
      await open("/dialogs", quick);
      const text = (await run({ command: "snapshot" }, {}, quick)).results[0].snapshot as string;
      const clicking = run({ command: "click", target: refOf(text, 'button "Spin"') }, {}, quick);
      await sleep(300);
      const id = "x-3";
      const cancelled = await run({ command: "cancel", execution: id }, {}, quick);
      expect(cancelled.execution).toMatchObject({ id, state: "cancelled" });
      expect((await clicking).execution.state).toBe("cancelled");
      expect(endedByEngine).toBe(0);
      const after = await run({ command: "snapshot" }, {}, quick);
      expect(after.results[0].snapshot).toContain('button "Spin"');
      quick.sessionEnded();
    });

    test("stops a cancelled page load without closing the tab", async () => {
      const uncached = await puppeteer.launch({
        executablePath: chrome,
        headless: true,
        args: [
          "--no-sandbox",
          "--host-resolver-rules=MAP *.test 127.0.0.1",
          "--disable-back-forward-cache",
        ],
      });
      try {
        current = uncached;
        const quick = create({ limits: { responseDeadlineMs: 300 } });
        const home = `${base}/basic?again=9000`;
        await open("/basic?again=9000", quick);
        const cancel = async (command: Record<string, unknown>) => {
          const running = await run(command, {}, quick);
          expect(running.execution.state, JSON.stringify(command)).toBe("running");
          const started = Date.now();
          await run({ command: "cancel", execution: running.execution.id }, {}, quick);
          const done = await finished(running.execution.id, quick);
          expect(done.execution.state).toBe("cancelled");
          expect(Date.now() - started).toBeLessThan(3000);
          const listed = await run({ command: "tab", action: "list" }, {}, quick);
          return (listed.results[0].tabs as Array<{ url: string }>).map((tab) => tab.url);
        };
        expect(await cancel({ command: "reload" })).toEqual([home]);
        expect(await cancel({ command: "navigate", url: `${base}/slow?ms=9000` })).toEqual([home]);
        await open("/forms", quick);
        expect(await cancel({ command: "back" })).toEqual([`${base}/forms`]);
        const tabs = await cancel({ command: "tab", action: "new", url: `${base}/slow?ms=9000` });
        expect(tabs).toHaveLength(2);
        expect(tabs[0]).toBe(`${base}/forms`);
        quick.sessionEnded();
      } finally {
        await uncached.close();
      }
    });

    test("moves on when a stop step hangs", async () => {
      const stuck = vi.spyOn(Tab.prototype, "stopLoading").mockReturnValue(new Promise(() => {}));
      try {
        const quick = create({ limits: { interruptGraceMs: 200, responseDeadlineMs: 300 } });
        await open("/dialogs", quick);
        const text = (await run({ command: "snapshot" }, {}, quick)).results[0].snapshot as string;
        const spinning = await run(
          { command: "click", target: refOf(text, 'button "Spin"') },
          {},
          quick,
        );
        const started = Date.now();
        const cancelled = await run(
          { command: "cancel", execution: spinning.execution.id },
          {},
          quick,
        );
        expect(cancelled.execution.state).toBe("cancelled");
        expect(Date.now() - started).toBeLessThan(5000);
        quick.sessionEnded();
      } finally {
        stuck.mockRestore();
      }
    });

    test("does not end a newer session when a stuck command finally gives up", async () => {
      await open("/counter");
      const spy = holdPress();
      try {
        const quick = create({
          limits: { interruptGraceMs: 200, responseDeadlineMs: 300, inputTimeoutMs: 20_000 },
        });
        const stuck = await run(
          { command: "click", target: { role: "button", name: "Add" } },
          {},
          quick,
        );
        const cancelling = send(
          { commands: { command: "cancel", execution: stuck.execution.id } },
          undefined,
          quick,
        );
        await sleep(1000);
        quick.prepare("s2");
        quick.browserReady();
        await cancelling;
        expect(endedByEngine).toBe(0);
        quick.sessionEnded();
      } finally {
        spy.mockRestore();
      }
    });

    test("cancels an execution that has not started", async () => {
      const slow = run({ command: "navigate", url: `${base}/slow?ms=3000` });
      await sleep(50);
      const queued = send({ commands: { command: "snapshot" } });
      await sleep(50);
      const cancelled = await run({ command: "cancel", execution: "x-2" });
      expect(cancelled.execution).toMatchObject({ state: "cancelled", effect: "none", ran: 0 });
      expect(((await queued).body as unknown as Envelope).execution.state).toBe("cancelled");
      expect((await slow).execution.state).toBe("completed");
    });
    test("stops a cancelled wait or typing without closing the tab", async () => {
      const quick = create({ limits: { responseDeadlineMs: 300 } });
      await open("/forms", quick);
      for (const command of [
        { command: "wait", target: "#never", timeout: 30000 },
        { command: "type", target: { label: "Name" }, text: "x".repeat(40), delay: 500 },
      ]) {
        const running = await run(command, {}, quick);
        expect(running.execution.state).toBe("running");
        const started = Date.now();
        await run({ command: "cancel", execution: running.execution.id }, {}, quick);
        const done = await finished(running.execution.id, quick);
        expect(done.execution.state).toBe("cancelled");
        expect(Date.now() - started).toBeLessThan(8000);
        const listed = await run({ command: "tab", action: "list" }, {}, quick);
        expect(listed.results[0].tabs).toHaveLength(1);
      }
      const typed = await page.evaluate(
        () => (document.querySelector('[aria-label="Name"]') as HTMLInputElement).value,
      );
      expect(typed.length).toBeLessThan("old".length + 40);
      quick.sessionEnded();
    });
  });

  describe("browser restart", () => {
    test("ends running work and old refs, then opens the queue again", async () => {
      await open("/basic");
      const ref = refOf(await snapshot(), 'button "Save"');
      const before = (await run({ command: "tab", action: "list" })).epoch;
      const replacement = await puppeteer.launch({
        executablePath: chrome,
        headless: true,
        args: ["--no-sandbox"],
      });
      const slow = send({ commands: { command: "navigate", url: `${base}/slow?ms=3000` } });
      await sleep(100);
      try {
        current = replacement;
        engine.browserClosed(browser);
        expect((await slow).body).toMatchObject({
          execution: { state: "failed", effect: "unknown", error: { code: "browser_restarted" } },
        });
        const waiting = send({ commands: { command: "tab", action: "list" } });
        engine.browserLaunched(replacement);
        engine.browserReady();
        const listed = (await waiting).body as unknown as Envelope;
        expect(listed.results[0].tabs).toEqual([expect.objectContaining({ tab: "t2" })]);
        expect(listed.epoch).toBeGreaterThan(before);
        expect(await click(ref)).toMatchObject({
          ok: false,
          error: { code: "stale_ref", reason: "browser_restarted" },
        });
        expect((await run({ command: "snapshot", tab: "t1" })).results[0]).toMatchObject({
          error: { code: "tab_not_found" },
        });
      } finally {
        engine.sessionEnded();
        await replacement.close();
      }
    });
  });

  describe("targets", () => {
    test("refuses blank locators and fields the request would ignore", async () => {
      await open("/locators");
      for (const commands of [
        { command: "click", target: { text: "   " } },
        { command: "click", target: "  " },
        { command: "click", target: { text: "Save", name: "Close" } },
      ]) {
        const response = await send({ commands });
        expect(response.status, JSON.stringify(commands)).toBe(400);
      }
      for (const command of [
        { command: "wait", text: "Save", state: "hidden" },
        { command: "find", by: "text", value: "Save", name: "Close" },
      ]) {
        expect((await run(command)).results[0], JSON.stringify(command)).toMatchObject({
          ok: false,
          error: { code: "invalid_argument" },
        });
      }
      expect(await page.title()).toBe("Locators");
    });

    test("refuses fields it does not know", async () => {
      const list = { command: "tab", action: "list" };
      expect((await send({ commands: list, aftr: "op_typo" })).status).toBe(400);
      expect((await send({ commands: { command: "snapshot", interactiv: true } })).status).toBe(
        400,
      );
      expect(
        (await send({ commands: list, observe: { mode: "snapshot", interactiv: true } })).status,
      ).toBe(400);
    });

    test("acts on locators", async () => {
      await open("/locators");
      const cases: Array<[unknown, string]> = [
        [{ role: "button", name: "Save" }, "saved"],
        [{ testid: "save-button" }, "saved"],
        [{ title: "Close panel" }, "closed"],
        [{ css: "button[title]" }, "closed"],
        ["button[data-testid=save-button]", "saved"],
        [{ label: "Labelled by caption" }, "labelled"],
        [{ role: "button", name: "Item", nth: 1 }, "second"],
        [{ role: "button", name: "Item", nth: -2 }, "first"],
      ];
      for (const [target, title] of cases) {
        await page.evaluate(() => (document.title = ""));
        const body = await run({ command: "click", target });
        expect(body.results[0], JSON.stringify(target)).toMatchObject({ ok: true });
        expect(await page.title(), JSON.stringify(target)).toBe(title);
      }
    });

    test("counts role matches in page order", async () => {
      await open("/role-order");
      await run({ command: "click", target: { role: "button", name: "Save", nth: 0 } });
      expect(await page.title()).toBe("deep");
      await run({ command: "click", target: { role: "button", name: "Save", nth: 1 } });
      expect(await page.title()).toBe("shallow");
    });

    test("finds elements and gives them the refs a snapshot would", async () => {
      await open("/locators");
      const cases: Array<[Record<string, unknown>, string, string]> = [
        [{ by: "label", value: "email address" }, "textbox", "Email address"],
        [{ by: "placeholder", value: "Search" }, "textbox", ""],
        [{ by: "alt", value: "Company logo", exact: true }, "image", "Company logo"],
        [{ by: "text", value: "terms" }, "generic", ""],
        [{ by: "role", value: "button", name: "item" }, "button", "Item"],
      ];
      for (const [query, role, name] of cases) {
        const result = (await run({ command: "find", ...query })).results[0];
        expect(result, JSON.stringify(query)).toMatchObject({ ok: true, effect: "none" });
        const first = (result.matches as Array<{ ref: string; role: string; name: string }>)[0];
        expect(first.role === role || role === "generic", JSON.stringify(result)).toBe(true);
        if (name) {
          expect(first.name).toBe(name);
        }
      }
      const items = (await run({ command: "find", by: "role", value: "button", name: "Item" }))
        .results[0];
      expect(items.count).toBe(2);
      const refs = (items.matches as Array<{ ref: string }>).map((match) => match.ref);
      const text = await snapshot();
      expect(text).toContain(`button "Item" [ref=${refs[0]}]`);
      expect(text).toContain(`button "Item" [ref=${refs[1]}]`);
      expect(await click(refs[1])).toMatchObject({ ok: true });
      expect(await page.title()).toBe("second");
    });

    test("reports a locator without a match and a bad selector", async () => {
      await open("/locators");
      expect(await click({ text: "Missing words" } as unknown as string)).toMatchObject({
        ok: false,
        effect: "none",
        error: { code: "element_not_found" },
      });
      expect(await click("button[[")).toMatchObject({
        ok: false,
        error: { code: "invalid_argument" },
      });
      const invalid = await send({
        commands: { command: "click", target: { role: "button", text: "x" } },
      });
      expect(invalid.status).toBe(400);
    });

    test("checks expect against the current element", async () => {
      await open("/locators");
      const ref = refOf(await snapshot(), 'button "Save"');
      const mismatch = await run({
        command: "click",
        target: ref,
        expect: { role: "button", name: "Close panel" },
      });
      expect(mismatch.results[0]).toMatchObject({
        ok: false,
        effect: "none",
        error: { code: "stale_ref", reason: "expect_mismatch" },
      });
      const fits = await run({ command: "click", target: ref, expect: { name: "Save" } });
      expect(fits.results[0]).toMatchObject({ ok: true });
    });

    test("finds a locator inside an iframe", async () => {
      await open("/frame");
      const frame = refOf(await snapshot(), "Iframe");
      const body = await run({
        command: "click",
        target: { role: "button", name: "Inner" },
        frame,
      });
      expect(body.results[0]).toMatchObject({ ok: true });
      expect(await page.title()).toBe("inner");
      await open("/oopif");
      const remote = refOf(await snapshot(), "Iframe");
      expect(
        (await run({ command: "click", target: { text: "Remote" }, frame: remote })).results[0],
      ).toMatchObject({ ok: true });
      const child = page.frames().find((candidate) => candidate.url().endsWith("/remote"));
      expect(await child?.evaluate(() => document.body.dataset.clicked)).toBe("yes");
    });

    test("hovers, double clicks, and focuses", async () => {
      await open("/locators");
      await run({ command: "hover", target: { text: "Hover me" } });
      expect(await page.title()).toBe("hovered");
      await run({ command: "dblclick", target: { text: "Double" } });
      expect(await page.title()).toBe("double");
      const focused = await run({ command: "focus", target: { label: "Focus target" } });
      expect(focused).toMatchObject({ results: [{ ok: true, effect: "applied" }], epoch: 4 });
      expect(await page.title()).toBe("focused");
    });

    test("waits for a page that is still loading before network idle", async () => {
      const quick = create({ limits: { navigationTimeoutMs: 500 } });
      await open("/stream-link", quick);
      const clicked = await run(
        { command: "click", target: { role: "link", name: "Stream" } },
        {},
        quick,
      );
      expect(clicked.results[0]).toMatchObject({ ok: true, loading: true });
      const waited = await run({ command: "wait", load: "networkidle" }, {}, quick);
      expect(waited.results[0]).toMatchObject({ ok: true, waited: "load" });
      expect(await page.evaluate(() => document.readyState)).toBe("complete");
      quick.sessionEnded();
    });

    test("reports the scroll that an element screenshot needs", async () => {
      await open("/far-element");
      const before = (await run({ command: "tab", action: "list" })).epoch;
      const scrolled = await run({ command: "screenshot", target: "#far" });
      expect(scrolled.results[0]).toMatchObject({ ok: true, effect: "applied" });
      expect(scrolled.epoch).toBeGreaterThan(before);
      const again = await run({ command: "screenshot", target: "#far" });
      expect(again.results[0]).toMatchObject({ ok: true, effect: "none" });
      expect(again.epoch).toBe(scrolled.epoch);
    });

    test("captures the parts of an element below the viewport", async () => {
      await open("/tall");
      const body = await run({ command: "screenshot", target: "#tall" });
      const pixel = await page.evaluate(async (data: string) => {
        const image = new Image();
        image.src = `data:image/png;base64,${data}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext("2d")!;
        context.drawImage(image, 0, 0);
        return [image.height, ...context.getImageData(100, image.height - 10, 1, 1).data];
      }, body.results[0].data as string);
      expect(pixel[0]).toBeGreaterThan(1500);
      expect(pixel.slice(1, 4)).toEqual([255, 0, 0]);
    });

    test("goes back, forward, and reloads", async () => {
      const fresh = await run({ command: "back" });
      expect(fresh.results[0]).toMatchObject({ ok: true, effect: "none", navigated: false });
      await open("/basic");
      await open("/counter");
      const back = await run({ command: "back" });
      expect(back.results[0]).toMatchObject({ ok: true, navigated: true, url: `${base}/basic` });
      expect(back.page).toMatchObject({ title: "Basic" });
      const forward = await run({ command: "forward" });
      expect(forward.results[0]).toMatchObject({ url: `${base}/counter` });
      await page.evaluate(() => ((window as unknown as { count: number }).count = 5));
      const reload = await run({ command: "reload" });
      expect(reload.results[0]).toMatchObject({ ok: true, effect: "applied" });
      expect(await count()).toBeUndefined();
    });
  });

  describe("forms", () => {
    function value(selector: string) {
      return page.evaluate(
        (css) => (document.querySelector(css) as HTMLInputElement).value,
        selector,
      );
    }

    test("fills and types into text fields", async () => {
      await open("/forms");
      await run({ command: "fill", target: { label: "Name" }, value: "Jun" });
      expect(await value("input")).toBe("Jun");
      expect(
        await page.evaluate(() => (window as unknown as { events: string[] }).events),
      ).toContain("input");
      await run({ command: "type", target: { label: "Name" }, text: " Kim" });
      expect(await value("input")).toBe("Jun Kim");
      await run({ command: "type", target: { label: "Name" }, text: "Lee", clear: true });
      expect(await value("input")).toBe("Lee");
      await run({ command: "fill", target: { label: "Name" }, value: "" });
      expect(await value("input")).toBe("");
      await run({ command: "type", target: { label: "Notes" }, text: "one\ntwo\r\nthree" });
      expect(await value("textarea")).toBe("one\ntwo\nthree");
      await run({ command: "fill", target: { label: "Editor" }, value: "hello" });
      expect(
        await page.evaluate(() => document.querySelector("[contenteditable]")!.textContent),
      ).toBe("hello");
    });

    test("refuses to fill something that is not a text field", async () => {
      await open("/forms");
      const body = await run({ command: "fill", target: { label: "Size" }, value: "m" });
      expect(body.results[0]).toMatchObject({
        ok: false,
        effect: "none",
        error: { code: "not_actionable", reason: "not_editable" },
      });
    });

    test("presses keys in a focused field", async () => {
      await open("/forms");
      await run([
        { command: "fill", target: { label: "Search" }, value: "cats" },
        { command: "press", key: "Enter", target: { label: "Search" } },
      ]);
      expect(await page.title()).toBe("searched cats");
      await run({ command: "press", key: "Control+a" });
      expect(await page.title()).toBe("searched cats");
    });

    test("selects options by label or value", async () => {
      await open("/forms");
      const medium = await run({ command: "select", target: { label: "Size" }, values: "Medium" });
      expect(medium.results[0]).toMatchObject({ ok: true, selected: ["m"] });
      await run({ command: "select", target: { label: "Size" }, values: ["l"] });
      expect(await value('select[aria-label="Size"]')).toBe("l");
      const unknown = await run({ command: "select", target: { label: "Size" }, values: "Huge" });
      expect(unknown.results[0]).toMatchObject({
        ok: false,
        effect: "none",
        error: { code: "invalid_argument" },
      });
      expect(unknown.results[0].error!.message).toContain("Small");
      const many = await run({
        command: "select",
        target: { label: "Toppings" },
        values: ["Cheese", "Olives"],
      });
      expect(many.results[0]).toMatchObject({ ok: true, selected: ["Cheese", "Olives"] });
      const single = await run({
        command: "select",
        target: { label: "Size" },
        values: ["s", "m"],
      });
      expect(single.results[0]).toMatchObject({ ok: false, error: { code: "invalid_argument" } });
    });

    test("checks and unchecks boxes, including hidden ones behind a label", async () => {
      await open("/forms");
      const checked = await run({ command: "check", target: { label: "Accept terms" } });
      expect(checked.results[0]).toMatchObject({ ok: true, effect: "applied", checked: true });
      const again = await run({ command: "check", target: { label: "Accept terms" } });
      expect(again.results[0]).toMatchObject({ ok: true, effect: "none", checked: true });
      await run({ command: "uncheck", target: { label: "Accept terms" } });
      expect(
        await page.evaluate(() => (document.getElementById("terms") as HTMLInputElement).checked),
      ).toBe(false);
      const hidden = await run({ command: "check", target: { text: "Newsletter" } });
      expect(hidden.results[0]).toMatchObject({ ok: true, checked: true });
      expect(
        await page.evaluate(() => (document.getElementById("news") as HTMLInputElement).checked),
      ).toBe(true);
    });

    test("types the shifted character for Shift with a letter or digit", async () => {
      await open("/shift-keys");
      const body = await run([
        { command: "press", key: "Shift+a", target: { label: "Field" } },
        { command: "press", key: "Shift+1", target: { label: "Field" } },
        { command: "get", what: "value", target: { label: "Field" } },
      ]);
      expect(body.results[2]).toMatchObject({ ok: true, value: "A!" });
    });

    test("types with real key events and refuses fields it cannot edit", async () => {
      await open("/keys");
      await run({ command: "type", target: { label: "First" }, text: "a\tb" });
      expect(await value('[aria-label="First"]')).toBe("a");
      expect(await value('[aria-label="Second"]')).toBe("b");
      const unknown = await run({ command: "press", key: "Hyper+q", target: { label: "First" } });
      expect(unknown.results[0]).toMatchObject({
        ok: false,
        effect: "none",
        error: { code: "invalid_argument" },
      });
      await run({ command: "press", key: "F2" });
      expect(await page.evaluate(() => (window as unknown as { keys: string[] }).keys)).toContain(
        "F2",
      );
      await run({ command: "fill", target: { label: "Limited" }, value: "abcdef" });
      expect(await value('[aria-label="Limited"]')).toBe("abc");
      const locked = await run({ command: "fill", target: { label: "Locked" }, value: "x" });
      expect(locked.results[0]).toMatchObject({
        ok: false,
        effect: "none",
        error: { code: "not_actionable", reason: "read_only" },
      });
      expect(await value('[aria-label="Locked"]')).toBe("fixed");
      await run({ command: "fill", target: { label: "Day" }, value: "2025-01-31" });
      expect(await value('[aria-label="Day"]')).toBe("2025-01-31");
      const bad = await run({ command: "fill", target: { label: "Day" }, value: "tomorrow" });
      expect(bad.results[0]).toMatchObject({ ok: false, error: { code: "invalid_argument" } });
      expect(await value('[aria-label="Day"]')).toBe("2025-01-31");
      const wrapper = await run({ command: "type", target: { label: "Wrapper" }, text: "x" });
      expect(wrapper.results[0]).toMatchObject({
        ok: false,
        error: { code: "not_actionable", reason: "not_focusable" },
      });
      const plain = await run({ command: "focus", target: { label: "Wrapper" } });
      expect(plain.results[0]).toMatchObject({
        ok: false,
        effect: "none",
        error: { code: "not_actionable", reason: "not_focusable" },
      });
      await run({ command: "fill", target: { label: "Tracked" }, value: "" });
      expect(await value('[aria-label="Tracked"]')).toBe("");
      expect(
        await page.evaluate(() => (window as unknown as { inputTypes: string[] }).inputTypes),
      ).toEqual(["deleteContentForward"]);
    });

    test("types characters as key presses that pages and widgets read", async () => {
      await open("/key-widget");
      const body = await run([
        { command: "type", target: { label: "Logged" }, text: "ab" },
        { command: "type", target: { label: "Widget" }, text: "hi" },
        { command: "type", target: { label: "Plain" }, text: "é한😀 x" },
      ]);
      expect(body.execution.state).toBe("completed");
      expect(await value('[aria-label="Logged"]')).toBe("ab");
      expect(await page.evaluate(() => (window as unknown as { log: string[] }).log)).toEqual([
        "down:a",
        "up:a",
        "down:b",
        "up:b",
      ]);
      expect(
        await page.evaluate(() => document.querySelector('[aria-label="Widget"]')!.textContent),
      ).toBe("hi");
      expect(await value('[aria-label="Plain"]')).toBe("é한😀 x");
    });

    test("types after the current content unless the field already has the cursor", async () => {
      await open("/prefilled");
      await run([
        { command: "type", target: { label: "Filled" }, text: "new" },
        { command: "type", target: { label: "Notes" }, text: "new" },
        { command: "type", target: { label: "Editor" }, text: "new" },
      ]);
      expect(await value('[aria-label="Filled"]')).toBe("oldnew");
      expect(await value('[aria-label="Notes"]')).toBe("oldnew");
      expect(
        await page.evaluate(() => document.querySelector('[aria-label="Editor"]')!.textContent),
      ).toBe("oldnew");
      await page.evaluate(() => {
        const placed = document.querySelector('[aria-label="Placed"]') as HTMLInputElement;
        placed.focus();
        placed.setSelectionRange(0, 0);
      });
      await run({ command: "type", target: { label: "Placed" }, text: "x" });
      expect(await value('[aria-label="Placed"]')).toBe("xold");
    });

    test("types after the current value of email and number fields", async () => {
      await open("/typed-kinds");
      await run([
        { command: "type", target: { label: "Email" }, text: "new" },
        { command: "type", target: { label: "Count" }, text: "34" },
      ]);
      expect(await value('[aria-label="Email"]')).toBe("old@x.comnew");
      expect(await value('[aria-label="Count"]')).toBe("1234");
    });

    test("reads a redrawn checkbox on its tab when the click opens another tab", async () => {
      await open("/check-popup");
      const body = await run({ command: "check", target: { label: "Agree" } });
      expect(body.results[0], JSON.stringify(body.results[0])).toMatchObject({
        ok: true,
        checked: true,
      });
    });

    test("toggles checkboxes, switches, and toggle buttons with real input", async () => {
      await open("/toggles");
      const aria = await run({ command: "check", target: { label: "Aria box" } });
      expect(aria.results[0]).toMatchObject({ ok: true, effect: "applied", checked: true });
      expect(
        (await run({ command: "is", what: "checked", target: { label: "Aria box" } })).results[0],
      ).toMatchObject({ value: true });
      const bold = await run({ command: "check", target: { role: "button", name: "Bold" } });
      expect(bold.results[0]).toMatchObject({ ok: true, effect: "applied", checked: true });
      const radio = await run({ command: "uncheck", target: { label: "Small" } });
      expect(radio.results[0]).toMatchObject({
        ok: false,
        effect: "none",
        error: { code: "invalid_argument" },
      });
      expect(
        (await run({ command: "check", target: { label: "Large" } })).results[0],
      ).toMatchObject({ ok: true, effect: "applied" });
      const covered = await run({ command: "check", target: { label: "Covered box" } });
      expect(covered.results[0]).toMatchObject({ ok: true, effect: "applied", checked: true });
      expect(
        await page.evaluate(() => (document.getElementById("covered") as HTMLInputElement).checked),
      ).toBe(true);
      const plain = await run({ command: "check", target: { text: "Plain text" } });
      expect(plain.results[0]).toMatchObject({
        ok: false,
        effect: "none",
        error: { code: "not_actionable", reason: "not_checkable" },
      });
    });

    test("does not press Space on a checkbox whose name changed under the mouse", async () => {
      await open("/renaming-checkbox");
      const checked = await run({ command: "check", target: { role: "checkbox", name: "Row A" } });
      expect(checked.results[0]).toMatchObject({
        ok: false,
        effect: "applied",
        error: { code: "not_actionable", reason: "content_changed" },
      });
      expect(await page.evaluate(() => document.querySelector("input")!.checked)).toBe(false);
    });

    test("checks an indeterminate checkbox", async () => {
      await open("/mixed");
      const body = await run({ command: "check", target: { label: "Mixed" } });
      expect(body.results[0]).toMatchObject({ ok: true, checked: true });
      expect(
        await page.evaluate(() => (document.getElementById("mixed") as HTMLInputElement).checked),
      ).toBe(true);
    });

    test("refuses to type into read-only fields and sets date fields", async () => {
      await open("/type-fields");
      const locked = await run({ command: "type", target: { label: "Locked" }, text: "abc" });
      expect(locked.results[0]).toMatchObject({
        ok: false,
        error: { code: "not_actionable", reason: "read_only" },
      });
      const day = await run({ command: "type", target: { label: "Day" }, text: "2025-01-31" });
      expect(day.results[0]).toMatchObject({ ok: true });
      expect(
        await page.evaluate(() => (document.getElementById("day") as HTMLInputElement).value),
      ).toBe("2025-01-31");
    });

    test("reports a field that leaves the page when it takes focus", async () => {
      await open("/vanish");
      const body = await run({ command: "type", target: { label: "Vanish" }, text: "abc" });
      expect(body.results[0]).toMatchObject({
        ok: false,
        error: { code: "stale_ref", reason: "detached" },
      });
    });

    test("checks a toggle that the page draws again when clicked", async () => {
      await open("/rerender-switch");
      const state = () =>
        page.evaluate(() => document.querySelector("[role=switch]")!.getAttribute("aria-checked"));
      const checked = await run({ command: "check", target: { role: "switch", name: "Wifi" } });
      expect(checked.results[0]).toMatchObject({ ok: true, effect: "applied", checked: true });
      expect(await state()).toBe("true");
      const ref = refOf(await snapshot(), 'switch "Wifi"');
      const unchecked = await run({ command: "uncheck", target: ref });
      expect(unchecked.results[0]).toMatchObject({
        ok: false,
        effect: "applied",
        error: { code: "stale_ref", reason: "detached" },
      });
      expect(await state()).toBe("false");
    });

    test("clicks the checkbox it found, not the middle of its container", async () => {
      await open("/toggle-row");
      const body = await run({ command: "check", target: "#row" });
      expect(body.results[0]).toMatchObject({ ok: true, checked: true });
      expect(await page.title()).toBe("Toggle row");
    });

    test("waits for a late toggle instead of pressing Space again", async () => {
      await open("/late-toggle");
      const body = await run({ command: "check", target: { role: "checkbox", name: "Late" } });
      expect(body.results[0]).toMatchObject({ ok: true, checked: true });
      await sleep(1000);
      expect(
        await page.evaluate(() => [
          document.querySelector("[role=checkbox]")!.getAttribute("aria-checked"),
          (window as unknown as { keys?: number }).keys ?? 0,
        ]),
      ).toEqual(["true", 0]);
    });

    test("treats controls in a disabled fieldset as disabled", async () => {
      await open("/fieldset");
      expect(
        (await run({ command: "is", what: "enabled", target: { label: "Size" } })).results[0],
      ).toMatchObject({ value: false });
      for (const command of [
        { command: "select", target: { label: "Size" }, values: "M" },
        { command: "fill", target: { label: "Day" }, value: "2026-10-22" },
        { command: "fill", target: { label: "Name" }, value: "x" },
      ]) {
        expect((await run(command)).results[0], JSON.stringify(command)).toMatchObject({
          ok: false,
          error: { code: "not_actionable", reason: "disabled" },
        });
      }
      expect(
        await page.evaluate(() =>
          [...document.querySelectorAll("select, input")].map(
            (field) => (field as HTMLInputElement).value,
          ),
        ),
      ).toEqual(["S", "", ""]);
    });

    test("selects options by value, label, or case and refuses disabled ones", async () => {
      await open("/options");
      const select = async (values: string) =>
        (await run({ command: "select", target: { label: "Plan" }, values })).results[0];
      expect(await select("pro")).toMatchObject({
        ok: false,
        error: { code: "not_actionable", reason: "disabled_option" },
      });
      expect(await select("team")).toMatchObject({
        ok: false,
        error: { reason: "disabled_option" },
      });
      expect(await select("Same")).toMatchObject({
        ok: false,
        error: { code: "invalid_argument" },
      });
      expect(await select("a2")).toMatchObject({ ok: true, effect: "applied", selected: ["a2"] });
      expect(await select("enterprise")).toMatchObject({ ok: true, selected: ["ent"] });
      const changes = await page.evaluate(() => (window as unknown as { changes: number }).changes);
      expect(await select("ent")).toMatchObject({ ok: true, effect: "none", selected: ["ent"] });
      expect(await page.evaluate(() => (window as unknown as { changes: number }).changes)).toBe(
        changes,
      );
    });

    test("scrolls the page", async () => {
      await open("/forms");
      const down = await run({ command: "scroll", direction: "down", amount: 500 });
      expect(down.results[0]).toMatchObject({ ok: true, effect: "applied", y: 500 });
      const up = await run({ command: "scroll", direction: "up", amount: 200 });
      expect(up.results[0]).toMatchObject({ y: 300 });
    });

    test("says when a scroll does not move anything", async () => {
      await open("/basic");
      const body = await run({ command: "scroll", direction: "down", amount: 500 });
      expect(body.results[0]).toMatchObject({ ok: true, effect: "none", moved: false, y: 0 });
    });
  });

  describe("reads", () => {
    test("reads the page or an element as Markdown without secrets", async () => {
      await open("/article");
      const page = (await run({ command: "get", what: "markdown" })).results[0];
      expect(page, JSON.stringify(page)).toMatchObject({ ok: true, effect: "none" });
      const text = page.value as string;
      expect(text).toContain("Release notes");
      expect(text).toContain(`[the docs](${base}/docs)`);
      expect(text).toContain("Second point");
      expect(text).not.toContain("hunter2-secret");
      expect(text).not.toContain("base64,");
      const list = (await run({ command: "get", what: "markdown", target: { css: "ul" } }))
        .results[0];
      expect(list.value).toContain("First point");
      expect(list.value).not.toContain("Release notes");
    });

    async function get(what: string, extra: Record<string, unknown> = {}) {
      const result = (await run({ command: "get", what, ...extra })).results[0];
      expect(result, JSON.stringify(result)).toMatchObject({ ok: true, effect: "none" });
      return result;
    }

    test("gets text, html, values, attributes, counts, and boxes", async () => {
      await open("/reads");
      expect((await get("text", { target: { css: "#head" } })).value).toBe("Hello world");
      expect((await get("html", { target: "#head" })).value).toBe("Hello <b>world</b>");
      expect((await get("attr", { target: "#head", attribute: "data-kind" })).value).toBe("title");
      expect((await get("value", { target: { label: "Email" } })).value).toBe("a@b.c");
      expect(await get("value", { target: { label: "Password" } })).toMatchObject({
        value: null,
        masked: true,
      });
      expect((await get("title")).value).toBe("Reads");
      expect((await get("url")).value).toMatch(/\/reads/);
      expect((await get("count", { target: "input" })).value).toBe(3);
      const box = (await get("box", { target: "#head" })).value as {
        width: number;
        height: number;
      };
      expect(box.width).toBeGreaterThan(0);
      expect(box.height).toBeGreaterThan(0);
      const missing = await run({ command: "get", what: "text" });
      expect(missing.results[0]).toMatchObject({ ok: false, error: { code: "invalid_argument" } });
    });

    test("answers is visible, enabled, and checked", async () => {
      await open("/reads");
      const is = async (what: string, target: unknown) =>
        (await run({ command: "is", what, target })).results[0];
      expect(await is("visible", { text: "Hello" })).toMatchObject({ ok: true, value: true });
      expect(await is("visible", { text: "Hidden text" })).toMatchObject({ value: false });
      expect(await is("visible", { text: "Nowhere at all" })).toMatchObject({
        ok: true,
        value: false,
      });
      expect(await is("enabled", { role: "button", name: "Off" })).toMatchObject({ value: false });
      expect(await is("enabled", { role: "button", name: "On" })).toMatchObject({ value: true });
      expect(await is("checked", { label: "Agree" })).toMatchObject({ value: true });
    });

    test("counts an element under a transparent parent as hidden", async () => {
      await open("/options");
      const is = async (name: string) =>
        (await run({ command: "is", what: "visible", target: { role: "button", name } }))
          .results[0];
      expect(await is("Ghost")).toMatchObject({ ok: true, value: false });
      expect(await is("Shown")).toMatchObject({ ok: true, value: true });
    });

    test("waits for elements, text, urls, and load states", async () => {
      await open("/reads");
      const target = await run({ command: "wait", target: { role: "button", name: "Ready" } });
      expect(target.results[0]).toMatchObject({ ok: true, effect: "none", waited: "target" });
      expect((await run({ command: "wait", text: "Ready" })).results[0]).toMatchObject({
        ok: true,
      });
      expect((await run({ command: "wait", url: "*/reads/done" })).results[0]).toMatchObject({
        ok: true,
        waited: "url",
      });
      expect((await run({ command: "wait", load: "load" })).results[0]).toMatchObject({ ok: true });
      expect((await run({ command: "wait", load: "networkidle" })).results[0]).toMatchObject({
        ok: true,
      });
      expect((await run({ command: "wait", ms: 50 })).results[0]).toMatchObject({ ok: true });
      expect(
        (await run({ command: "wait", target: { text: "Hidden text" }, state: "hidden" }))
          .results[0],
      ).toMatchObject({ ok: true });
      const never = await run({ command: "wait", text: "Never shows up", timeout: 300 });
      expect(never.results[0]).toMatchObject({
        ok: false,
        effect: "none",
        error: { code: "timeout", reason: "wait" },
      });
      const both = await run({ command: "wait", text: "Ready", ms: 10 });
      expect(both.results[0]).toMatchObject({ ok: false, error: { code: "invalid_argument" } });
    });

    test("finds text inside open shadow roots", async () => {
      await open("/shadow-text");
      const waited = await run({ command: "wait", text: "Shadow hello", timeout: 3000 });
      expect(waited.results[0]).toMatchObject({ ok: true });
    });

    test("keeps polling through a protocol error while the page changes", async () => {
      await open("/basic");
      await page.evaluate(() => setTimeout(() => document.body.append("arrived"), 600));
      const original = CdpCDPSession.prototype.send;
      let thrown = false;
      const spy = vi.spyOn(CdpCDPSession.prototype, "send").mockImplementation(async function (
        this: CdpCDPSession,
        method: string,
        params?: unknown,
        options?: unknown,
      ) {
        if (method === "Runtime.callFunctionOn" && !thrown) {
          thrown = true;
          throw new ProtocolError("Execution context was destroyed.");
        }
        return (original as (...args: unknown[]) => Promise<unknown>).call(
          this,
          method,
          params,
          options,
        );
      } as never);
      try {
        const waited = await run({ command: "wait", text: "arrived", timeout: 3000 });
        expect(waited.results[0]).toMatchObject({ ok: true });
        expect(thrown).toBe(true);
      } finally {
        spy.mockRestore();
      }
    });

    test("reports a cancelled timed wait as cancelled", async () => {
      const quick = create({ limits: { responseDeadlineMs: 300 } });
      await open("/basic", quick);
      const started = (await send({ commands: { command: "wait", ms: 5000 } }, undefined, quick))
        .body as unknown as Envelope;
      expect(started.execution.state).toBe("running");
      await run({ command: "cancel", execution: started.execution.id }, {}, quick);
      const body = await finished(started.execution.id, quick);
      expect(body.results[0]).toMatchObject({ ok: false, error: { code: "cancelled" } });
      quick.sessionEnded();
    });

    test("does not treat an unknown ref as gone", async () => {
      await open("/reads");
      const waited = await run({
        command: "wait",
        target: "e999",
        state: "detached",
        timeout: 300,
      });
      expect(waited.results[0]).toMatchObject({
        ok: false,
        error: { code: "stale_ref", reason: "unknown" },
      });
    });

    test("waits for requests that started before a networkidle wait", async () => {
      await open("/nav");
      const loaded = await run([
        { command: "click", target: { role: "button", name: "Load" } },
        { command: "wait", load: "networkidle" },
        { command: "get", what: "title" },
      ]);
      expect(loaded.results[2]).toMatchObject({ value: "loaded" });
    });

    test("lets the page free elements that commands looked up", async () => {
      await open("/grow");
      const client = await page.createCDPSession();
      const nodes = async () => {
        await client.send("HeapProfiler.collectGarbage");
        return (await client.send("Memory.getDOMCounters")).nodes;
      };
      const before = await nodes();
      for (let round = 0; round < 10; round++) {
        await page.evaluate(() => (window as unknown as { grow: () => void }).grow());
        await run([
          { command: "get", what: "count", target: { css: "#box span" } },
          { command: "get", what: "text", target: { css: "#box button" } },
        ]);
        await page.evaluate(() => (window as unknown as { shrink: () => void }).shrink());
      }
      const after = await nodes();
      await client.detach();
      expect(after - before).toBeLessThan(1000);
    });

    test("takes screenshots and prints a pdf", async () => {
      await open("/reads");
      const page = (await run({ command: "screenshot" })).results[0];
      expect(page).toMatchObject({ ok: true, effect: "none", format: "png" });
      expect(page.data as string).toMatch(/^iVBOR/);
      const element = (await run({ command: "screenshot", target: "#head" })).results[0];
      expect(element.data as string).toMatch(/^iVBOR/);
      expect((element.data as string).length).toBeLessThan((page.data as string).length);
      const full = (
        await run({ command: "screenshot", fullPage: true, format: "jpeg", quality: 50 })
      ).results[0];
      expect(full.data as string).toMatch(/^\/9j\//);
      const pdf = (await run({ command: "pdf" })).results[0];
      expect(pdf).toMatchObject({ ok: true, format: "pdf" });
      expect(pdf.data as string).toMatch(/^JVBER/);
    });
  });

  describe("coordinates and scripts", () => {
    async function log(): Promise<string[]> {
      return page.evaluate(() => (window as unknown as { log: string[] }).log);
    }

    test("drives the mouse at coordinates", async () => {
      await open("/pad");
      const body = await run([
        { command: "mouse", action: "move", x: 50, y: 60 },
        { command: "mouse", action: "down" },
        { command: "mouse", action: "move", x: 120, y: 90 },
        { command: "mouse", action: "up" },
        { command: "mouse", action: "click", x: 200, y: 100, clicks: 2 },
        { command: "mouse", action: "click", x: 10, y: 10, button: "right" },
        { command: "mouse", action: "wheel", x: 100, y: 100, deltaY: 120 },
      ]);
      expect(body.execution.state, JSON.stringify(body.results)).toBe("completed");
      const events = await log();
      expect(events).toContain("mousedown 50 60 0 1 false 0");
      expect(events).toContain("mousemove 120 90 0 1 false 0");
      expect(events).toContain("mouseup 120 90 0 0 false 0");
      expect(events).toContain("dblclick 200 100 0 0 false 0");
      expect(events).toContain("mousedown 10 10 2 2 false 0");
      expect(events.some((event) => event.startsWith("contextmenu 10 10"))).toBe(true);
      expect(events).toContain("wheel 100 100 0 0 false 120");
    });

    test("needs a point for mouse input", async () => {
      await open("/pad");
      const fresh = await run({ command: "mouse", action: "click", x: 5 });
      expect(fresh.results[0]).toMatchObject({ ok: false, error: { code: "invalid_argument" } });
      const nowhere = await run({ command: "mouse", action: "wheel", deltaY: 10 });
      expect(nowhere.results[0]).toMatchObject({ ok: false, error: { code: "invalid_argument" } });
    });

    test("holds keys down until keyup and applies held modifiers", async () => {
      await open("/pad");
      const body = await run([
        { command: "focus", target: "#field" },
        { command: "keydown", key: "a" },
        { command: "keyup", key: "a" },
        { command: "keydown", key: "Shift" },
        { command: "keydown", key: "b" },
        { command: "keyup", key: "b" },
        { command: "mouse", action: "click", x: 30, y: 30 },
        { command: "keyup", key: "Shift" },
        { command: "mouse", action: "click", x: 40, y: 40 },
      ]);
      expect(body.execution.state, JSON.stringify(body.results)).toBe("completed");
      expect(await page.$eval("#field", (field) => (field as HTMLInputElement).value)).toBe("aB");
      const events = await log();
      expect(events).toContain("click 30 30 0 0 true 0");
      expect(events).toContain("click 40 40 0 0 false 0");
      const chord = await run({ command: "keydown", key: "Shift+a" });
      expect(chord.results[0]).toMatchObject({ ok: false, error: { code: "invalid_argument" } });
    });

    test("runs a script in the page and returns its value", async () => {
      await open("/pad");
      await run({ command: "mouse", action: "click", x: 20, y: 20 });
      const length = await run({ command: "eval", script: "window.log.length" });
      expect(length.results[0]).toMatchObject({ ok: true, effect: "applied" });
      expect(length.results[0].value).toBeGreaterThan(0);
      const later = await run({
        command: "eval",
        script: "new Promise((resolve) => setTimeout(() => resolve({ a: [1, 'x'] }), 50))",
      });
      expect(later.results[0].value).toEqual({ a: [1, "x"] });
      const nothing = await run({ command: "eval", script: "void 0" });
      expect(nothing.results[0]).toEqual({ ok: true, effect: "applied" });
      const thrown = await run({ command: "eval", script: "throw new Error('boom')" });
      expect(thrown.results[0]).toMatchObject({ ok: false, error: { code: "script_error" } });
      expect(thrown.results[0].error!.message).toContain("boom");
      const big = await run({ command: "eval", script: "'x'.repeat(200000)" });
      expect(big.results[0]).toMatchObject({
        ok: false,
        error: { code: "invalid_argument", reason: "too_large" },
      });
    });

    test("hides secrets in script results", async () => {
      await open("/article");
      const body = await run({
        command: "eval",
        script: "({ value: document.querySelector('input[type=password]').value })",
      });
      expect(body.results[0].value).toEqual({ value: "••••••••" });
    });

    test("stops a script that runs too long and keeps the page usable", async () => {
      await open("/pad");
      const pending = await run({ command: "eval", script: "new Promise(() => {})", timeout: 300 });
      expect(pending.results[0]).toMatchObject({ ok: false, error: { code: "timeout" } });
      const looping = await run({ command: "eval", script: "while (true) {}", timeout: 300 });
      expect(looping.results[0]).toMatchObject({ ok: false, error: { code: "timeout" } });
      const after = await run({ command: "eval", script: "1 + 1" });
      expect(after.results[0]).toMatchObject({ ok: true, value: 2 });
    });

    test("reports a dialog that a script opens", async () => {
      await open("/pad");
      const body = await run({ command: "eval", script: "alert('from script')" });
      expect(body.results[0]).toMatchObject({
        ok: false,
        effect: "applied",
        error: { code: "dialog_pending", reason: "during_script" },
      });
      expect(body.dialog).toMatchObject({ type: "alert", message: "from script" });
      await run({ command: "dialog", dialog: body.dialog!.id, action: "accept" });
      expect((await run({ command: "eval", script: "1" })).results[0]).toMatchObject({ value: 1 });
    });
  });

  describe("upload and drag", () => {
    test("uploads files from the session files only", async () => {
      await open("/upload");
      const single = await run({
        command: "upload",
        target: { label: "Single" },
        files: "report.txt",
      });
      expect(single.results[0]).toMatchObject({
        ok: true,
        effect: "applied",
        files: ["report.txt"],
      });
      expect(await page.title()).toBe("got report.txt:5");
      await run({
        command: "upload",
        target: { label: "Many" },
        files: ["report.txt", "data.csv"],
      });
      expect(await page.title()).toBe("many 2");
      const refused: Array<[unknown, string, string]> = [
        ["../" + outside.split("/").pop() + "/secret.txt", "forbidden_file", "outside_files"],
        [join(outside, "secret.txt"), "forbidden_file", "outside_files"],
        ["link.txt", "forbidden_file", "outside_files"],
        ["missing.txt", "forbidden_file", "missing"],
        ["../no-such-folder/secret.txt", "forbidden_file", "outside_files"],
        ["/no/such/file.txt", "forbidden_file", "outside_files"],
      ];
      for (const [name, code, reason] of refused) {
        const body = await run({ command: "upload", target: { label: "Single" }, files: name });
        expect(body.results[0], String(name)).toMatchObject({
          ok: false,
          effect: "none",
          error: { code, reason },
        });
      }
      const two = await run({
        command: "upload",
        target: { label: "Single" },
        files: ["report.txt", "data.csv"],
      });
      expect(two.results[0]).toMatchObject({ ok: false, error: { code: "invalid_argument" } });
      const button = await run({
        command: "upload",
        target: { text: "Not a file input" },
        files: "report.txt",
      });
      expect(button.results[0]).toMatchObject({
        ok: false,
        error: { code: "not_actionable", reason: "not_file_input" },
      });
    });

    test("drags one element onto another", async () => {
      await open("/drag");
      const body = await run({
        command: "drag",
        source: { text: "Card" },
        target: { text: "Drop zone" },
      });
      expect(body.results[0]).toMatchObject({ ok: true, effect: "applied" });
      expect(await page.title()).toBe("dropped card");
    });
  });

  describe("observe, events, and secrets", () => {
    test("observes a diff against the last snapshot or a given base", async () => {
      await open("/rows");
      const first = await run({ command: "snapshot" });
      const base = first.results[0].snapshotId as string;
      await page.evaluate(() => (window as unknown as { shift: () => void }).shift());
      const changed = await run({ command: "tab", action: "list" }, { observe: { mode: "diff" } });
      expect(changed.observe).toMatchObject({ base, additions: 3, removals: 3 });
      expect(changed.observe?.diff).toContain("-");
      expect(changed.observe?.diff).toContain('+    - StaticText "Order 1003"');
      const same = await run({ command: "tab", action: "list" }, { observe: { mode: "diff" } });
      expect(same.observe).toMatchObject({ diff: "", additions: 0, removals: 0 });
      const unknown = await run(
        { command: "tab", action: "list" },
        { observe: { mode: "diff", base: "s-999" } },
      );
      expect(unknown.observe).toMatchObject({ full: true });
      expect(unknown.observe?.snapshot).toContain("Order 1003");
      const other = await run(
        { command: "tab", action: "list" },
        { observe: { mode: "diff", base, interactive: true } },
      );
      expect(other.observe).toMatchObject({ full: true });
    });

    test("keeps the diff base when a snapshot ends after its execution", async () => {
      const short = create({ limits: { executionLimitMs: 400 } });
      await open("/rows", short);
      const first = await run({ command: "snapshot" }, {}, short);
      const base = first.results[0].snapshotId as string;
      const original = CdpCDPSession.prototype.send;
      let delayed = false;
      const spy = vi.spyOn(CdpCDPSession.prototype, "send").mockImplementation(async function (
        this: CdpCDPSession,
        method: string,
        params?: unknown,
        options?: unknown,
      ) {
        if (method === "Accessibility.getFullAXTree" && !delayed) {
          delayed = true;
          await sleep(1000);
        }
        return (original as (...args: unknown[]) => Promise<unknown>).call(
          this,
          method,
          params,
          options,
        );
      } as never);
      try {
        const late = await run({ command: "snapshot" }, {}, short);
        expect(late.execution.state).toBe("timeout");
        await sleep(1500);
      } finally {
        spy.mockRestore();
      }
      const observed = await run(
        { command: "tab", action: "list" },
        { observe: { mode: "diff" } },
        short,
      );
      expect(observed.observe).toMatchObject({ base });
      short.sessionEnded();
    });

    test("reports the first navigation of a popup", async () => {
      await open("/opener");
      const start = await run({ command: "tab", action: "list" }, { eventsAfter: "c-0" });
      const cursor = (start as unknown as { events: { cursor: string } }).events.cursor;
      await run({ command: "click", target: refOf(await snapshot(), 'button "Open"') });
      const popup = await tabWith("/basic");
      await sleep(300);
      const later = (await run(
        { command: "tab", action: "list" },
        { eventsAfter: cursor },
      )) as unknown as { events: { items: Array<Record<string, unknown>> } };
      expect(later.events.items, JSON.stringify(later.events.items)).toContainEqual(
        expect.objectContaining({ type: "navigation", tab: popup, url: `${base}/basic` }),
      );
    });

    test("refuses old refs and tabs after other sessions ran in between", async () => {
      await open("/basic");
      const ref = refOf(await snapshot(), 'button "Save"');
      engine.prepare("s2");
      engine.browserReady();
      engine.prepare(SESSION);
      engine.browserReady();
      await open("/danger");
      await snapshot();
      const clicked = await run({ command: "click", target: ref });
      expect(clicked.results[0], JSON.stringify(clicked.results[0])).toMatchObject({
        ok: false,
        error: { code: "stale_ref", reason: "unknown" },
      });
      expect(await page.title()).toBe("Danger");
      const old = await run({ command: "snapshot", tab: "t1" });
      expect(old.results[0], JSON.stringify(old.results[0])).toMatchObject({
        ok: false,
        error: { code: "tab_not_found" },
      });
    });

    test("keeps the event cursor going when the same session starts again", async () => {
      await open("/basic");
      await run({ command: "navigate", url: `${base}/counter` });
      const before = await run({ command: "tab", action: "list" }, { eventsAfter: "c-0" });
      const old = (before as unknown as { events: { cursor: string } }).events.cursor;
      engine.prepare(SESSION);
      engine.browserReady();
      await run({ command: "navigate", url: `${base}/basic` });
      const later = (await run(
        { command: "tab", action: "list" },
        { eventsAfter: old },
      )) as unknown as { events: { cursor: string; items: Array<Record<string, unknown>> } };
      expect(later.events.items, JSON.stringify(later.events)).toContainEqual(
        expect.objectContaining({ type: "navigation", url: `${base}/basic` }),
      );
      expect(later.events.cursor).not.toBe(old);
    });

    test("refuses old refs and execution ids after the same session starts again", async () => {
      await open("/basic");
      const ref = refOf(await snapshot(), 'button "Save"');
      engine.prepare(SESSION);
      engine.browserReady();
      await open("/counter");
      await snapshot();
      const clicked = await run({ command: "click", target: ref });
      expect(clicked.results[0], JSON.stringify(clicked.results[0])).toMatchObject({
        ok: false,
        error: { code: "stale_ref" },
      });
      expect(await count()).toBeUndefined();
      const status = await send({ commands: { command: "status", execution: "x-2" } });
      expect(status.status, JSON.stringify(status.body)).toBe(422);
    });

    test("waits for the downloads that clicks started, one at a time", async () => {
      const setup = await browser.target().createCDPSession();
      onTestFinished(() => setup.detach());
      await setup.send("Browser.setDownloadBehavior", {
        behavior: "allow",
        downloadPath: downloads,
        eventsEnabled: true,
      });
      await open("/download");
      const body = await run([
        { command: "click", target: { text: "Get report" } },
        { command: "wait", download: true },
      ]);
      expect(body.results[1], JSON.stringify(body.results[1])).toMatchObject({
        ok: true,
        waited: "download",
        file: "report.txt",
        bytes: 5,
      });
      expect(await readFile(join(downloads, "report.txt"), "utf8")).toBe("hello");
      const none = await run({ command: "wait", download: true, timeout: 300 });
      expect(none.results[0]).toMatchObject({ ok: false, error: { code: "timeout" } });
      await run({ command: "click", target: { text: "Get report" } });
      await sleep(500);
      const later = await run({ command: "wait", download: true });
      expect(later.results[0], JSON.stringify(later.results[0])).toMatchObject({
        ok: true,
        file: "report.txt",
      });
    });

    test("reports navigations, tabs, dialogs, and downloads after a cursor", async () => {
      const setup = await browser.target().createCDPSession();
      onTestFinished(() => setup.detach());
      await setup.send("Browser.setDownloadBehavior", {
        behavior: "allow",
        downloadPath: downloads,
        eventsEnabled: true,
      });
      const start = await run({ command: "tab", action: "list" }, { eventsAfter: "c-0" });
      const cursor = (start as unknown as { events: { cursor: string } }).events.cursor;
      await open("/opener");
      await run({ command: "click", target: refOf(await snapshot(), 'button "Open"') });
      await sleep(300);
      await run({ command: "tab", action: "close", tab: "t2" });
      await open("/dialogs");
      const alerted = await run({
        command: "click",
        target: refOf(await snapshot(), 'button "Alert"'),
      });
      await run({ command: "dialog", dialog: alerted.dialog!.id, action: "accept" });
      await open("/download");
      await run({ command: "click", target: { text: "Get report" } });
      await vi.waitFor(
        async () => {
          const events = (await run(
            { command: "tab", action: "list" },
            { eventsAfter: cursor },
          )) as unknown as { events: { items: Array<Record<string, unknown>> } };
          expect(events.events.items).toContainEqual(
            expect.objectContaining({ type: "download", state: "completed" }),
          );
        },
        { timeout: 10000, interval: 50 },
      );
      const later = (await run(
        { command: "tab", action: "list" },
        { eventsAfter: cursor },
      )) as unknown as {
        events: { cursor: string; items: Array<Record<string, unknown>> };
      };
      const types = later.events.items.map((item) => `${item.type}:${item.tab}`);
      expect(types).toContain("navigation:t1");
      expect(later.events.items).toContainEqual(
        expect.objectContaining({ type: "tab_opened", tab: "t2", opener: "t1" }),
      );
      expect(types).toContain("tab_closed:t2");
      expect(later.events.items).toContainEqual(
        expect.objectContaining({
          type: "dialog",
          dialog: expect.objectContaining({ type: "alert", accepted: true }),
        }),
      );
      expect(later.events.items).toContainEqual(
        expect.objectContaining({ type: "download", file: "report.txt", state: "completed" }),
      );
      const again = (await run(
        { command: "tab", action: "list" },
        { eventsAfter: later.events.cursor },
      )) as unknown as {
        events: { items: unknown[] };
      };
      expect(again.events.items).toEqual([]);
    });

    test("hides secrets in find results, errors, text, html, and clickable text", async () => {
      await open("/secret-paths");
      const text = (await snapshot()) + (await snapshot({ interactive: true }));
      for (const secret of ["5150", "9876", "zzz-script", "hidden words"]) {
        expect(text, text).not.toContain(secret);
      }
      expect(text).toMatch(/"Open" \[ref=e\d+\] clickable/);
      const found = await run({ command: "find", by: "role", value: "button" });
      expect(JSON.stringify(found.results[0])).not.toContain("9876");
      const mismatch = await run({
        command: "click",
        target: { role: "button" },
        expect: { name: "Something else" },
      });
      expect(mismatch.results[0]).toMatchObject({ error: { reason: "expect_mismatch" } });
      expect(mismatch.results[0].error!.message).not.toContain("9876");
      const reads = await run([
        { command: "get", what: "text", target: "#box" },
        { command: "get", what: "html", target: "#box" },
      ]);
      for (const result of reads.results) {
        expect(String(result.value)).not.toContain("hunter22");
        expect(String(result.value)).not.toContain("pass1234");
      }
    });

    test("hides a secret that HTML escapes", async () => {
      await open("/secret-html");
      const html = (await run({ command: "get", what: "html", target: "#box" })).results[0];
      expect(String(html.value)).toContain("Shown:");
      expect(String(html.value)).not.toContain("123");
    });

    test("hides the value of a secret textarea in the snapshot", async () => {
      await open("/secret-textarea");
      const text = await snapshot();
      expect(text).toContain('textbox "Recovery"');
      expect(text).not.toContain("swordfish");
    });

    test("hides a short secret in error messages", async () => {
      await open("/short-secret");
      const mismatch = await run({
        command: "click",
        target: { role: "button" },
        expect: { name: "Other" },
      });
      expect(mismatch.results[0].error!.message).toContain("PIN");
      expect(mismatch.results[0].error!.message).not.toContain("42");
      await open("/short-cover");
      const covered = await run({ command: "click", target: { text: "Under" } });
      expect(covered.results[0]).toMatchObject({ error: { reason: "covered" } });
      expect(covered.results[0].error!.message).toContain("PIN");
      expect(covered.results[0].error!.message).not.toContain("42");
    });

    test("hides secrets from closed shadow roots and editable secret fields", async () => {
      await open("/secret-closed");
      const read = await run({ command: "get", what: "text", target: "body" });
      expect(String(read.results[0].value)).toContain("Code:");
      expect(String(read.results[0].value)).not.toContain("closed-secret-99");
      expect(String(read.results[0].value)).not.toContain("editable-secret-77");
      const html = await run({ command: "get", what: "html", target: "body" });
      expect(String(html.results[0].value)).not.toContain("closed-secret-99");
      expect(String(html.results[0].value)).not.toContain("editable-secret-77");
    });

    test("hides editable secret regions in interactive snapshots", async () => {
      await open("/secret-closed");
      const text = (await snapshot()) + (await snapshot({ interactive: true }));
      expect(text).not.toContain("editable-secret-77");
      expect(text).not.toContain("closed-secret-99");
      await open("/secret-editable");
      const short = await snapshot({ interactive: true });
      expect(short).toContain("Note");
      expect(short).not.toContain("zqx");
    });

    test("hides short secrets from closed shadow roots in errors and find results", async () => {
      await open("/secret-shadow-name");
      const mismatch = await run({
        command: "click",
        target: { role: "button" },
        expect: { name: "Other" },
      });
      expect(mismatch.results[0].error!.message).toContain("PIN");
      expect(mismatch.results[0].error!.message).not.toContain("qzv");
      const found = await run({ command: "find", by: "role", value: "button" });
      expect(found.results[0]).toMatchObject({ matches: [{ name: "PIN ••••••••" }] });
      await open("/secret-shadow-cover");
      const covered = await run({ command: "click", target: { text: "Under" } });
      expect(covered.results[0]).toMatchObject({ error: { reason: "covered" } });
      expect(covered.results[0].error!.message).toContain("PIN");
      expect(covered.results[0].error!.message).not.toContain("qzv");
    });

    test("hides the part of a secret region that a read targets", async () => {
      await open("/secret-inner");
      const reads = await run([
        { command: "get", what: "text", target: "#inner" },
        { command: "get", what: "html", target: "#inner" },
      ]);
      for (const result of reads.results) {
        expect(String(result.value), String(result.value)).not.toContain("bravo");
      }
    });

    test("hides a secret that the clickable text limit cuts through", async () => {
      await open("/secret-cut");
      const text = await snapshot({ interactive: true });
      expect(text).toContain("xxxx");
      expect(text).not.toContain("hunt");
    });

    test("hides secret editable regions that contain markup in text and html", async () => {
      await open("/secret-markup");
      const reads = await run([
        { command: "get", what: "text", target: "#box" },
        { command: "get", what: "html", target: "#box" },
      ]);
      for (const result of reads.results) {
        expect(String(result.value)).toContain("Note");
        for (const secret of ["qqqq", "zzzz", "wwww"]) {
          expect(String(result.value), String(result.value)).not.toContain(secret);
        }
      }
    });

    test("hides a short secret in find results", async () => {
      await open("/short-secret");
      const found = await run({ command: "find", by: "role", value: "button" });
      expect(found.results[0]).toMatchObject({ matches: [{ name: "PIN ••••••••" }] });
    });

    test("hides a secret in the names of the elements around it", async () => {
      await open("/secret-name");
      const text = await snapshot();
      expect(text).not.toContain("9876");
      expect(text).not.toContain("4321");
      expect(text).toContain('button "Code ••••••••"');
    });

    test("hides passwords and filled credentials", async () => {
      await open("/secrets");
      const text = await snapshot();
      expect(text).toContain('textbox "User"');
      expect(text).toContain("jun@steel.dev");
      expect(text).not.toContain("hunter2");
      expect(text).not.toContain("vault-secret");
      expect(text).toMatch(/textbox "Password" \[ref=e\d+\]: ••••••••\n/);
      for (const label of ["Password", "Vault"]) {
        expect(
          (await run({ command: "get", what: "value", target: { label } })).results[0],
        ).toMatchObject({
          value: null,
          masked: true,
        });
      }
      expect(
        (
          await run({
            command: "get",
            what: "attr",
            target: { label: "Password" },
            attribute: "value",
          })
        ).results[0],
      ).toMatchObject({ masked: true });
      expect(
        (await run({ command: "get", what: "value", target: { label: "User" } })).results[0],
      ).toMatchObject({
        value: "jun@steel.dev",
      });
    });
  });

  describe("record cleanup", () => {
    test("clears records of expired afters when the records are full", async () => {
      let offset = 0;
      const small = create({ limits: { maxRecords: 3 }, now: () => Date.now() + offset });
      const start = (await send({ commands: { command: "tab", action: "list" } }, "k0", small))
        .body as unknown as Envelope;
      const one = await run({ command: "tab", action: "list" }, { after: start.next }, small);
      await run({ command: "tab", action: "list" }, { after: one.next }, small);
      expect(
        (await send({ commands: { command: "tab", action: "list" } }, "k1", small)).status,
      ).toBe(429);
      offset = 10 * 60_000;
      const fresh = await send({ commands: { command: "tab", action: "list" } }, "k2", small);
      expect(fresh.status).toBe(200);
      const next = (fresh.body as unknown as Envelope).next;
      const followed = await send(
        { commands: { command: "tab", action: "list" }, after: next },
        undefined,
        small,
      );
      expect(followed.status).toBe(200);
      const stale = await send(
        { commands: { command: "tab", action: "list" }, after: one.next },
        undefined,
        small,
      );
      expect(stale.status).toBe(422);
      expect(stale.body).toMatchObject({ error: { code: "invalid_operation_token" } });
    });

    test("frees header key records an hour after they finish when the records are full", async () => {
      let offset = 0;
      const small = create({ limits: { maxRecords: 3 }, now: () => Date.now() + offset });
      const list = { command: "tab", action: "list" };
      let next = (await run(list, {}, small)).next;
      for (const key of ["k1", "k2", "k3"]) {
        const response = await send({ commands: list, after: next }, key, small);
        expect(response.status).toBe(200);
        next = (response.body as unknown as Envelope).next;
      }
      offset = 30 * 60_000;
      expect((await send({ commands: list }, "k4", small)).status).toBe(429);
      offset = 61 * 60_000;
      expect((await send({ commands: list }, "k5", small)).status).toBe(200);
      const again = await send({ commands: list }, "k5", small);
      expect(again.body).toMatchObject({ execution: { replayed: true } });
      small.sessionEnded();
    });

    test("keeps a header key record after its after expires", async () => {
      let offset = 0;
      const small = create({ limits: { maxRecords: 3 }, now: () => Date.now() + offset });
      await open("/counter", small);
      const text = (await run({ command: "snapshot" }, {}, small)).results[0].snapshot as string;
      const start = await run({ command: "tab", action: "list" }, {}, small);
      const click = { command: "click", target: refOf(text, 'button "Add"') };
      const first = await send({ commands: click, after: start.next }, "click-1", small);
      expect(first.status).toBe(200);
      await send({ commands: { command: "tab", action: "list" } }, "k-a", small);
      await send({ commands: { command: "tab", action: "list" } }, "k-b", small);
      offset = 10 * 60_000;
      await send({ commands: { command: "tab", action: "list" } }, "k-c", small);
      let retry = await send({ commands: click, after: start.next }, "click-1", small);
      if (retry.status === 422) {
        const next = (retry.body as unknown as Envelope).next;
        retry = await send({ commands: click, after: next }, "click-1", small);
      }
      expect(retry.status).toBe(200);
      expect(retry.body).toMatchObject({ execution: { replayed: true } });
      expect(await count()).toBe(1);
    });

    test("does not run a request whose after the cleanup just dropped", async () => {
      let offset = 0;
      const small = create({ limits: { maxRecords: 3 }, now: () => Date.now() + offset });
      await open("/counter", small);
      const start = (await send({ commands: { command: "tab", action: "list" } }, "k0", small))
        .body as unknown as Envelope;
      const one = await run({ command: "tab", action: "list" }, { after: start.next }, small);
      const two = await run({ command: "tab", action: "list" }, { after: one.next }, small);
      offset = 6 * 60_000;
      const click = {
        commands: { command: "click", target: { role: "button", name: "Add" } },
        after: two.next,
      };
      await send(click, undefined, small);
      let retry = await send(click, undefined, small);
      if (retry.status === 422) {
        const next = (retry.body as unknown as Envelope).next;
        retry = await send({ ...click, after: next }, undefined, small);
      }
      expect(retry.status).toBe(200);
      expect(await count()).toBe(1);
    });

    test("replays an after retry when its Idempotency-Key record expired", async () => {
      const quick = create({ limits: { responseDeadlineMs: 300 } });
      await open("/counter", quick);
      const start = await run({ command: "tab", action: "list" }, {}, quick);
      const click = {
        commands: { command: "click", target: { role: "button", name: "Add" } },
        after: start.next,
      };
      const busy = await run({ command: "wait", ms: 1000 }, {}, quick);
      expect((await send(click, "key-1", quick)).status).toBe(429);
      await finished(busy.execution.id, quick);
      const ran = (await send(click, "key-2", quick)).body as unknown as Envelope;
      const again = (await send(click, "key-1", quick)).body as unknown as Envelope;
      expect(again.execution).toMatchObject({ id: ran.execution.id, replayed: true });
      expect(await count()).toBe(1);
    });

    test("drops large bodies first when they pass the budget", async () => {
      const small = create({ limits: { maxBodyBytes: 200 } });
      await open("/basic", small);
      const first = await send({ commands: { command: "snapshot" } }, "body-1", small);
      expect((first.body as unknown as Envelope).results[0].snapshot).toBeDefined();
      await send({ commands: { command: "snapshot" } }, "body-2", small);
      const replay = (await send({ commands: { command: "snapshot" } }, "body-1", small))
        .body as unknown as Envelope;
      expect(replay).toMatchObject({ bodyExpired: true, execution: { replayed: true } });
      expect(replay.results[0].snapshot).toBeUndefined();
    });
  });
});

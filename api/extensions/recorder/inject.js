(function () {
  if (window.__RECORDER_INJECTED__) {
    console.log("[Recorder] Already injected, skipping...");
    return;
  }
  // Mark as injected immediately
  window.__RECORDER_INJECTED__ = true;

  (function (g, f) {
    if ("object" == typeof exports && "object" == typeof module) {
      module.exports = f();
    } else if ("function" == typeof define && define.amd) {
      define("rrweb", [], f);
    } else if ("object" == typeof exports) {
      exports["rrweb"] = f();
    } else {
      g["rrweb"] = f();
    }
  })(this, () => {
    var exports = {};
    var module = { exports };
    ("use strict");
    var Ha = Object.defineProperty,
      Za = Object.defineProperties;
    var Xa = Object.getOwnPropertyDescriptors;
    var Ot = Object.getOwnPropertySymbols;
    var Ni = Object.prototype.hasOwnProperty,
      Ai = Object.prototype.propertyIsEnumerable;
    var Ri = (s, e, t) =>
        e in s
          ? Ha(s, e, {
              enumerable: !0,
              configurable: !0,
              writable: !0,
              value: t,
            })
          : (s[e] = t),
      R = (s, e) => {
        for (var t in e || (e = {})) Ni.call(e, t) && Ri(s, t, e[t]);
        if (Ot) for (var t of Ot(e)) Ai.call(e, t) && Ri(s, t, e[t]);
        return s;
      },
      Q = (s, e) => Za(s, Xa(e));
    var Le = (s, e) => {
      var t = {};
      for (var r in s) Ni.call(s, r) && e.indexOf(r) < 0 && (t[r] = s[r]);
      if (s != null && Ot) for (var r of Ot(s)) e.indexOf(r) < 0 && Ai.call(s, r) && (t[r] = s[r]);
      return t;
    };
    var Ja = Object.defineProperty,
      Ka = (s, e, t) =>
        e in s
          ? Ja(s, e, {
              enumerable: !0,
              configurable: !0,
              writable: !0,
              value: t,
            })
          : (s[e] = t),
      b = (s, e, t) => Ka(s, typeof e != "symbol" ? e + "" : e, t),
      Oi;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    var Qa = Object.defineProperty,
      qa = (s, e, t) =>
        e in s
          ? Qa(s, e, {
              enumerable: !0,
              configurable: !0,
              writable: !0,
              value: t,
            })
          : (s[e] = t),
      Di = (s, e, t) => qa(s, typeof e != "symbol" ? e + "" : e, t),
      M = ((s) => (
        (s[(s.Document = 0)] = "Document"),
        (s[(s.DocumentType = 1)] = "DocumentType"),
        (s[(s.Element = 2)] = "Element"),
        (s[(s.Text = 3)] = "Text"),
        (s[(s.CDATA = 4)] = "CDATA"),
        (s[(s.Comment = 5)] = "Comment"),
        s
      ))(M || {});
    const Ti = {
        Node: ["childNodes", "parentNode", "parentElement", "textContent"],
        ShadowRoot: ["host", "styleSheets"],
        Element: ["shadowRoot", "querySelector", "querySelectorAll"],
        MutationObserver: [],
      },
      _i = {
        Node: ["contains", "getRootNode"],
        ShadowRoot: ["getSelection"],
        Element: [],
        MutationObserver: ["constructor"],
      },
      Dt = {};
    function Ps(s) {
      if (Dt[s]) return Dt[s];
      const e = globalThis[s],
        t = e.prototype,
        r = s in Ti ? Ti[s] : void 0,
        i = !!(
          r &&
          r.every((a) => {
            var l, u;
            return !!(
              (u = (l = Object.getOwnPropertyDescriptor(t, a)) == null ? void 0 : l.get) != null &&
              u.toString().includes("[native code]")
            );
          })
        ),
        o = s in _i ? _i[s] : void 0,
        n = !!(
          o &&
          o.every((a) => {
            var l;
            return typeof t[a] == "function" && ((l = t[a]) == null ? void 0 : l.toString().includes("[native code]"));
          })
        );
      if (i && n) return (Dt[s] = e.prototype), e.prototype;
      try {
        const a = document.createElement("iframe");
        document.body.appendChild(a);
        const l = a.contentWindow;
        if (!l) return e.prototype;
        const u = l[s].prototype;
        return document.body.removeChild(a), u ? (Dt[s] = u) : t;
      } catch (a) {
        return t;
      }
    }
    const Ur = {};
    function Me(s, e, t) {
      var r;
      const i = `${s}.${String(t)}`;
      if (Ur[i]) return Ur[i].call(e);
      const o = Ps(s),
        n = (r = Object.getOwnPropertyDescriptor(o, t)) == null ? void 0 : r.get;
      return n ? ((Ur[i] = n), n.call(e)) : e[t];
    }
    const Wr = {};
    function Vn(s, e, t) {
      const r = `${s}.${String(t)}`;
      if (Wr[r]) return Wr[r].bind(e);
      const o = Ps(s)[t];
      return typeof o != "function" ? e[t] : ((Wr[r] = o), o.bind(e));
    }
    function el(s) {
      return Me("Node", s, "childNodes");
    }
    function tl(s) {
      return Me("Node", s, "parentNode");
    }
    function rl(s) {
      return Me("Node", s, "parentElement");
    }
    function sl(s) {
      return Me("Node", s, "textContent");
    }
    function il(s, e) {
      return Vn("Node", s, "contains")(e);
    }
    function nl(s) {
      return Vn("Node", s, "getRootNode")();
    }
    function ol(s) {
      return !s || !("host" in s) ? null : Me("ShadowRoot", s, "host");
    }
    function al(s) {
      return s.styleSheets;
    }
    function ll(s) {
      return !s || !("shadowRoot" in s) ? null : Me("Element", s, "shadowRoot");
    }
    function ul(s, e) {
      return Me("Element", s, "querySelector")(e);
    }
    function cl(s, e) {
      return Me("Element", s, "querySelectorAll")(e);
    }
    function hl() {
      return Ps("MutationObserver").constructor;
    }
    const ee = {
      childNodes: el,
      parentNode: tl,
      parentElement: rl,
      textContent: sl,
      contains: il,
      getRootNode: nl,
      host: ol,
      styleSheets: al,
      shadowRoot: ll,
      querySelector: ul,
      querySelectorAll: cl,
      mutationObserver: hl,
    };
    function Ls(s) {
      return s.nodeType === s.ELEMENT_NODE;
    }
    function lt(s) {
      const e = (s && "host" in s && "mode" in s && ee.host(s)) || null;
      return !!(e && "shadowRoot" in e && ee.shadowRoot(e) === s);
    }
    function ut(s) {
      return Object.prototype.toString.call(s) === "[object ShadowRoot]";
    }
    function fl(s) {
      return (
        s.includes(" background-clip: text;") &&
          !s.includes(" -webkit-background-clip: text;") &&
          (s = s.replace(/\sbackground-clip:\s*text;/g, " -webkit-background-clip: text; background-clip: text;")),
        s
      );
    }
    function dl(s) {
      const { cssText: e } = s;
      if (e.split('"').length < 3) return e;
      const t = ["@import", `url(${JSON.stringify(s.href)})`];
      return (
        s.layerName === "" ? t.push("layer") : s.layerName && t.push(`layer(${s.layerName})`),
        s.supportsText && t.push(`supports(${s.supportsText})`),
        s.media.length && t.push(s.media.mediaText),
        t.join(" ") + ";"
      );
    }
    function lr(s) {
      try {
        const e = s.rules || s.cssRules;
        if (!e) return null;
        const t = Array.from(e, (r) => Gn(r, s.href)).join("");
        return fl(t);
      } catch (e) {
        return null;
      }
    }
    function Gn(s, e) {
      if (ml(s)) {
        let t;
        try {
          t = lr(s.styleSheet) || dl(s);
        } catch (r) {
          t = s.cssText;
        }
        return s.styleSheet.href ? ur(t, s.styleSheet.href) : t;
      } else {
        let t = s.cssText;
        return gl(s) && s.selectorText.includes(":") && (t = pl(t)), e ? ur(t, e) : t;
      }
    }
    function pl(s) {
      const e = /(\[(?:[\w-]+)[^\\])(:(?:[\w-]+)\])/gm;
      return s.replace(e, "$1\\$2");
    }
    function ml(s) {
      return "styleSheet" in s;
    }
    function gl(s) {
      return "selectorText" in s;
    }
    class Fs {
      constructor() {
        Di(this, "idNodeMap", new Map()), Di(this, "nodeMetaMap", new WeakMap());
      }
      getId(e) {
        var t;
        if (!e) return -1;
        const r = (t = this.getMeta(e)) == null ? void 0 : t.id;
        return r != null ? r : -1;
      }
      getNode(e) {
        return this.idNodeMap.get(e) || null;
      }
      getIds() {
        return Array.from(this.idNodeMap.keys());
      }
      getMeta(e) {
        return this.nodeMetaMap.get(e) || null;
      }
      removeNodeFromMap(e) {
        const t = this.getId(e);
        this.idNodeMap.delete(t), e.childNodes && e.childNodes.forEach((r) => this.removeNodeFromMap(r));
      }
      has(e) {
        return this.idNodeMap.has(e);
      }
      hasNode(e) {
        return this.nodeMetaMap.has(e);
      }
      add(e, t) {
        const r = t.id;
        this.idNodeMap.set(r, e), this.nodeMetaMap.set(e, t);
      }
      replace(e, t) {
        const r = this.getNode(e);
        if (r) {
          const i = this.nodeMetaMap.get(r);
          i && this.nodeMetaMap.set(t, i);
        }
        this.idNodeMap.set(e, t);
      }
      reset() {
        (this.idNodeMap = new Map()), (this.nodeMetaMap = new WeakMap());
      }
    }
    function jn() {
      return new Fs();
    }
    function Bs({ element: s, maskInputOptions: e, tagName: t, type: r, value: i, maskInputFn: o }) {
      let n = i || "";
      const a = r && xe(r);
      return (e[t.toLowerCase()] || (a && e[a])) && (o ? (n = o(n, s)) : (n = "*".repeat(n.length))), n;
    }
    function xe(s) {
      return s.toLowerCase();
    }
    const ki = "__rrweb_original__";
    function yl(s) {
      const e = s.getContext("2d");
      if (!e) return !0;
      const t = 50;
      for (let r = 0; r < s.width; r += t)
        for (let i = 0; i < s.height; i += t) {
          const o = e.getImageData,
            n = ki in o ? o[ki] : o;
          if (
            new Uint32Array(n.call(e, r, i, Math.min(t, s.width - r), Math.min(t, s.height - i)).data.buffer).some(
              (l) => l !== 0,
            )
          )
            return !1;
        }
      return !0;
    }
    function wl(s, e) {
      return !s || !e || s.type !== e.type
        ? !1
        : s.type === M.Document
        ? s.compatMode === e.compatMode
        : s.type === M.DocumentType
        ? s.name === e.name && s.publicId === e.publicId && s.systemId === e.systemId
        : s.type === M.Comment || s.type === M.Text || s.type === M.CDATA
        ? s.textContent === e.textContent
        : s.type === M.Element
        ? s.tagName === e.tagName &&
          JSON.stringify(s.attributes) === JSON.stringify(e.attributes) &&
          s.isSVG === e.isSVG &&
          s.needBlock === e.needBlock
        : !1;
    }
    function Us(s) {
      const e = s.type;
      return s.hasAttribute("data-rr-is-password") ? "password" : e ? xe(e) : null;
    }
    function Yn(s, e) {
      var o;
      let t;
      try {
        t = new URL(s, e != null ? e : window.location.href);
      } catch (n) {
        return null;
      }
      const r = /\.([0-9a-z]+)(?:$)/i,
        i = t.pathname.match(r);
      return (o = i == null ? void 0 : i[1]) != null ? o : null;
    }
    function bl(s) {
      let e = "";
      return (
        s.indexOf("//") > -1 ? (e = s.split("/").slice(0, 3).join("/")) : (e = s.split("/")[0]),
        (e = e.split("?")[0]),
        e
      );
    }
    const Sl = /url\((?:(')([^']*)'|(")(.*?)"|([^)]*))\)/gm,
      vl = /^(?:[a-z+]+:)?\/\//i,
      Cl = /^www\..*/i,
      El = /^(data:)([^,]*),(.*)/i;
    function ur(s, e) {
      return (s || "").replace(Sl, (t, r, i, o, n, a) => {
        const l = i || n || a,
          u = r || o || "";
        if (!l) return t;
        if (vl.test(l) || Cl.test(l)) return `url(${u}${l}${u})`;
        if (El.test(l)) return `url(${u}${l}${u})`;
        if (l[0] === "/") return `url(${u}${bl(e) + l}${u})`;
        const c = e.split("/"),
          h = l.split("/");
        c.pop();
        for (const f of h) f !== "." && (f === ".." ? c.pop() : c.push(f));
        return `url(${u}${c.join("/")}${u})`;
      });
    }
    let Il = 1;
    const xl = new RegExp("[^a-z0-9-_:]"),
      ft = -2;
    function Hn() {
      return Il++;
    }
    function Ml(s) {
      if (s instanceof HTMLFormElement) return "form";
      const e = xe(s.tagName);
      return xl.test(e) ? "div" : e;
    }
    let Fe, $i;
    const Rl = /^[^ \t\n\r\u000c]+/,
      Nl = /^[, \t\n\r\u000c]+/;
    function Al(s, e) {
      if (e.trim() === "") return e;
      let t = 0;
      function r(o) {
        let n;
        const a = o.exec(e.substring(t));
        return a ? ((n = a[0]), (t += n.length), n) : "";
      }
      const i = [];
      for (; r(Nl), !(t >= e.length); ) {
        let o = r(Rl);
        if (o.slice(-1) === ",") (o = ze(s, o.substring(0, o.length - 1))), i.push(o);
        else {
          let n = "";
          o = ze(s, o);
          let a = !1;
          for (;;) {
            const l = e.charAt(t);
            if (l === "") {
              i.push((o + n).trim());
              break;
            } else if (a) l === ")" && (a = !1);
            else if (l === ",") {
              (t += 1), i.push((o + n).trim());
              break;
            } else l === "(" && (a = !0);
            (n += l), (t += 1);
          }
        }
      }
      return i.join(", ");
    }
    const Pi = new WeakMap();
    function ze(s, e) {
      return !e || e.trim() === "" ? e : Ws(s, e);
    }
    function Ol(s) {
      return !!(s.tagName === "svg" || s.ownerSVGElement);
    }
    function Ws(s, e) {
      let t = Pi.get(s);
      if ((t || ((t = s.createElement("a")), Pi.set(s, t)), !e)) e = "";
      else if (e.startsWith("blob:") || e.startsWith("data:")) return e;
      return t.setAttribute("href", e), t.href;
    }
    function Zn(s, e, t, r) {
      return (
        r &&
        (t === "src" ||
        (t === "href" && !(e === "use" && r[0] === "#")) ||
        (t === "xlink:href" && r[0] !== "#") ||
        (t === "background" && (e === "table" || e === "td" || e === "th"))
          ? ze(s, r)
          : t === "srcset"
          ? Al(s, r)
          : t === "style"
          ? ur(r, Ws(s))
          : e === "object" && t === "data"
          ? ze(s, r)
          : r)
      );
    }
    function Xn(s, e, t) {
      return (s === "video" || s === "audio") && e === "autoplay";
    }
    function Dl(s, e, t) {
      try {
        if (typeof e == "string") {
          if (s.classList.contains(e)) return !0;
        } else
          for (let r = s.classList.length; r--; ) {
            const i = s.classList[r];
            if (e.test(i)) return !0;
          }
        if (t) return s.matches(t);
      } catch (r) {}
      return !1;
    }
    function cr(s, e, t) {
      if (!s) return !1;
      if (s.nodeType !== s.ELEMENT_NODE) return t ? cr(ee.parentNode(s), e, t) : !1;
      for (let r = s.classList.length; r--; ) {
        const i = s.classList[r];
        if (e.test(i)) return !0;
      }
      return t ? cr(ee.parentNode(s), e, t) : !1;
    }
    function Jn(s, e, t, r) {
      let i;
      if (Ls(s)) {
        if (((i = s), !ee.childNodes(i).length)) return !1;
      } else {
        if (ee.parentElement(s) === null) return !1;
        i = ee.parentElement(s);
      }
      try {
        if (typeof e == "string") {
          if (r) {
            if (i.closest(`.${e}`)) return !0;
          } else if (i.classList.contains(e)) return !0;
        } else if (cr(i, e, r)) return !0;
        if (t) {
          if (r) {
            if (i.closest(t)) return !0;
          } else if (i.matches(t)) return !0;
        }
      } catch (o) {}
      return !1;
    }
    function Tl(s, e, t) {
      const r = s.contentWindow;
      if (!r) return;
      let i = !1,
        o;
      try {
        o = r.document.readyState;
      } catch (a) {
        return;
      }
      if (o !== "complete") {
        const a = setTimeout(() => {
          i || (e(), (i = !0));
        }, t);
        s.addEventListener("load", () => {
          clearTimeout(a), (i = !0), e();
        });
        return;
      }
      const n = "about:blank";
      if (r.location.href !== n || s.src === n || s.src === "") return setTimeout(e, 0), s.addEventListener("load", e);
      s.addEventListener("load", e);
    }
    function _l(s, e, t) {
      let r = !1,
        i;
      try {
        i = s.sheet;
      } catch (n) {
        return;
      }
      if (i) return;
      const o = setTimeout(() => {
        r || (e(), (r = !0));
      }, t);
      s.addEventListener("load", () => {
        clearTimeout(o), (r = !0), e();
      });
    }
    function kl(s, e) {
      const {
          doc: t,
          mirror: r,
          blockClass: i,
          blockSelector: o,
          needsMask: n,
          inlineStylesheet: a,
          maskInputOptions: l = {},
          maskTextFn: u,
          maskInputFn: c,
          dataURLOptions: h = {},
          inlineImages: f,
          recordCanvas: p,
          keepIframeSrcFn: g,
          newlyAddedElement: m = !1,
        } = e,
        d = $l(t, r);
      switch (s.nodeType) {
        case s.DOCUMENT_NODE:
          return s.compatMode !== "CSS1Compat"
            ? { type: M.Document, childNodes: [], compatMode: s.compatMode }
            : { type: M.Document, childNodes: [] };
        case s.DOCUMENT_TYPE_NODE:
          return {
            type: M.DocumentType,
            name: s.name,
            publicId: s.publicId,
            systemId: s.systemId,
            rootId: d,
          };
        case s.ELEMENT_NODE:
          return Ll(s, {
            doc: t,
            blockClass: i,
            blockSelector: o,
            inlineStylesheet: a,
            maskInputOptions: l,
            maskInputFn: c,
            dataURLOptions: h,
            inlineImages: f,
            recordCanvas: p,
            keepIframeSrcFn: g,
            newlyAddedElement: m,
            rootId: d,
          });
        case s.TEXT_NODE:
          return Pl(s, { doc: t, needsMask: n, maskTextFn: u, rootId: d });
        case s.CDATA_SECTION_NODE:
          return { type: M.CDATA, textContent: "", rootId: d };
        case s.COMMENT_NODE:
          return {
            type: M.Comment,
            textContent: ee.textContent(s) || "",
            rootId: d,
          };
        default:
          return !1;
      }
    }
    function $l(s, e) {
      if (!e.hasNode(s)) return;
      const t = e.getId(s);
      return t === 1 ? void 0 : t;
    }
    function Pl(s, e) {
      var t;
      const { needsMask: r, maskTextFn: i, rootId: o } = e,
        n = ee.parentNode(s),
        a = n && n.tagName;
      let l = ee.textContent(s);
      const u = a === "STYLE" ? !0 : void 0,
        c = a === "SCRIPT" ? !0 : void 0;
      if (u && l) {
        try {
          s.nextSibling || s.previousSibling || ((t = n.sheet) != null && t.cssRules && (l = lr(n.sheet)));
        } catch (h) {
          console.warn(`Cannot get CSS styles from text's parentNode. Error: ${h}`, s);
        }
        l = ur(l, Ws(e.doc));
      }
      return (
        c && (l = "SCRIPT_PLACEHOLDER"),
        !u && !c && l && r && (l = i ? i(l, ee.parentElement(s)) : l.replace(/[\S]/g, "*")),
        { type: M.Text, textContent: l || "", isStyle: u, rootId: o }
      );
    }
    function Ll(s, e) {
      const {
          doc: t,
          blockClass: r,
          blockSelector: i,
          inlineStylesheet: o,
          maskInputOptions: n = {},
          maskInputFn: a,
          dataURLOptions: l = {},
          inlineImages: u,
          recordCanvas: c,
          keepIframeSrcFn: h,
          newlyAddedElement: f = !1,
          rootId: p,
        } = e,
        g = Dl(s, r, i),
        m = Ml(s);
      let d = {};
      const y = s.attributes.length;
      for (let w = 0; w < y; w++) {
        const v = s.attributes[w];
        Xn(m, v.name, v.value) || (d[v.name] = Zn(t, m, xe(v.name), v.value));
      }
      if (m === "link" && o) {
        const w = Array.from(t.styleSheets).find((x) => x.href === s.href);
        let v = null;
        w && (v = lr(w)), v && (delete d.rel, delete d.href, (d._cssText = v));
      }
      if (m === "style" && s.sheet && !(s.innerText || ee.textContent(s) || "").trim().length) {
        const w = lr(s.sheet);
        w && (d._cssText = w);
      }
      if (m === "input" || m === "textarea" || m === "select") {
        const w = s.value,
          v = s.checked;
        d.type !== "radio" && d.type !== "checkbox" && d.type !== "submit" && d.type !== "button" && w
          ? (d.value = Bs({
              element: s,
              type: Us(s),
              tagName: m,
              value: w,
              maskInputOptions: n,
              maskInputFn: a,
            }))
          : v && (d.checked = v);
      }
      if (
        (m === "option" && (s.selected && !n.select ? (d.selected = !0) : delete d.selected),
        m === "dialog" && s.open && (d.rr_open_mode = s.matches("dialog:modal") ? "modal" : "non-modal"),
        m === "canvas" && c)
      ) {
        if (s.__context === "2d") yl(s) || (d.rr_dataURL = s.toDataURL(l.type, l.quality));
        else if (!("__context" in s)) {
          const w = s.toDataURL(l.type, l.quality),
            v = t.createElement("canvas");
          (v.width = s.width), (v.height = s.height);
          const x = v.toDataURL(l.type, l.quality);
          w !== x && (d.rr_dataURL = w);
        }
      }
      if (m === "img" && u) {
        Fe || ((Fe = t.createElement("canvas")), ($i = Fe.getContext("2d")));
        const w = s,
          v = w.currentSrc || w.getAttribute("src") || "<unknown-src>",
          x = w.crossOrigin,
          N = () => {
            w.removeEventListener("load", N);
            try {
              (Fe.width = w.naturalWidth),
                (Fe.height = w.naturalHeight),
                $i.drawImage(w, 0, 0),
                (d.rr_dataURL = Fe.toDataURL(l.type, l.quality));
            } catch (z) {
              if (w.crossOrigin !== "anonymous") {
                (w.crossOrigin = "anonymous"), w.complete && w.naturalWidth !== 0 ? N() : w.addEventListener("load", N);
                return;
              } else console.warn(`Cannot inline img src=${v}! Error: ${z}`);
            }
            w.crossOrigin === "anonymous" && (x ? (d.crossOrigin = x) : w.removeAttribute("crossorigin"));
          };
        w.complete && w.naturalWidth !== 0 ? N() : w.addEventListener("load", N);
      }
      if (m === "audio" || m === "video") {
        const w = d;
        (w.rr_mediaState = s.paused ? "paused" : "played"),
          (w.rr_mediaCurrentTime = s.currentTime),
          (w.rr_mediaPlaybackRate = s.playbackRate),
          (w.rr_mediaMuted = s.muted),
          (w.rr_mediaLoop = s.loop),
          (w.rr_mediaVolume = s.volume);
      }
      if ((f || (s.scrollLeft && (d.rr_scrollLeft = s.scrollLeft), s.scrollTop && (d.rr_scrollTop = s.scrollTop)), g)) {
        const { width: w, height: v } = s.getBoundingClientRect();
        d = { class: d.class, rr_width: `${w}px`, rr_height: `${v}px` };
      }
      m === "iframe" && !h(d.src) && (s.contentDocument || (d.rr_src = d.src), delete d.src);
      let S;
      try {
        customElements.get(m) && (S = !0);
      } catch (w) {}
      return {
        type: M.Element,
        tagName: m,
        attributes: d,
        childNodes: [],
        isSVG: Ol(s) || void 0,
        needBlock: g,
        rootId: p,
        isCustom: S,
      };
    }
    function W(s) {
      return s == null ? "" : s.toLowerCase();
    }
    function Fl(s, e) {
      if (e.comment && s.type === M.Comment) return !0;
      if (s.type === M.Element) {
        if (
          e.script &&
          (s.tagName === "script" ||
            (s.tagName === "link" &&
              (s.attributes.rel === "preload" || s.attributes.rel === "modulepreload") &&
              s.attributes.as === "script") ||
            (s.tagName === "link" &&
              s.attributes.rel === "prefetch" &&
              typeof s.attributes.href == "string" &&
              Yn(s.attributes.href) === "js"))
        )
          return !0;
        if (
          e.headFavicon &&
          ((s.tagName === "link" && s.attributes.rel === "shortcut icon") ||
            (s.tagName === "meta" &&
              (W(s.attributes.name).match(/^msapplication-tile(image|color)$/) ||
                W(s.attributes.name) === "application-name" ||
                W(s.attributes.rel) === "icon" ||
                W(s.attributes.rel) === "apple-touch-icon" ||
                W(s.attributes.rel) === "shortcut icon")))
        )
          return !0;
        if (s.tagName === "meta") {
          if (e.headMetaDescKeywords && W(s.attributes.name).match(/^description|keywords$/)) return !0;
          if (
            e.headMetaSocial &&
            (W(s.attributes.property).match(/^(og|twitter|fb):/) ||
              W(s.attributes.name).match(/^(og|twitter):/) ||
              W(s.attributes.name) === "pinterest")
          )
            return !0;
          if (
            e.headMetaRobots &&
            (W(s.attributes.name) === "robots" ||
              W(s.attributes.name) === "googlebot" ||
              W(s.attributes.name) === "bingbot")
          )
            return !0;
          if (e.headMetaHttpEquiv && s.attributes["http-equiv"] !== void 0) return !0;
          if (
            e.headMetaAuthorship &&
            (W(s.attributes.name) === "author" ||
              W(s.attributes.name) === "generator" ||
              W(s.attributes.name) === "framework" ||
              W(s.attributes.name) === "publisher" ||
              W(s.attributes.name) === "progid" ||
              W(s.attributes.property).match(/^article:/) ||
              W(s.attributes.property).match(/^product:/))
          )
            return !0;
          if (
            e.headMetaVerification &&
            (W(s.attributes.name) === "google-site-verification" ||
              W(s.attributes.name) === "yandex-verification" ||
              W(s.attributes.name) === "csrf-token" ||
              W(s.attributes.name) === "p:domain_verify" ||
              W(s.attributes.name) === "verify-v1" ||
              W(s.attributes.name) === "verification" ||
              W(s.attributes.name) === "shopify-checkout-api-token")
          )
            return !0;
        }
      }
      return !1;
    }
    function Ve(s, e) {
      const {
        doc: t,
        mirror: r,
        blockClass: i,
        blockSelector: o,
        maskTextClass: n,
        maskTextSelector: a,
        skipChild: l = !1,
        inlineStylesheet: u = !0,
        maskInputOptions: c = {},
        maskTextFn: h,
        maskInputFn: f,
        slimDOMOptions: p,
        dataURLOptions: g = {},
        inlineImages: m = !1,
        recordCanvas: d = !1,
        onSerialize: y,
        onIframeLoad: S,
        iframeLoadTimeout: w = 5e3,
        onStylesheetLoad: v,
        stylesheetLoadTimeout: x = 5e3,
        keepIframeSrcFn: N = () => !1,
        newlyAddedElement: z = !1,
      } = e;
      let { needsMask: D } = e,
        { preserveWhiteSpace: J = !0 } = e;
      D || (D = Jn(s, n, a, D === void 0));
      const K = kl(s, {
        doc: t,
        mirror: r,
        blockClass: i,
        blockSelector: o,
        needsMask: D,
        inlineStylesheet: u,
        maskInputOptions: c,
        maskTextFn: h,
        maskInputFn: f,
        dataURLOptions: g,
        inlineImages: m,
        recordCanvas: d,
        keepIframeSrcFn: N,
        newlyAddedElement: z,
      });
      if (!K) return console.warn(s, "not serialized"), null;
      let se;
      r.hasNode(s)
        ? (se = r.getId(s))
        : Fl(K, p) || (!J && K.type === M.Text && !K.isStyle && !K.textContent.replace(/^\s+|\s+$/gm, "").length)
        ? (se = ft)
        : (se = Hn());
      const T = Object.assign(K, { id: se });
      if ((r.add(s, T), se === ft)) return null;
      y && y(s);
      let fe = !l;
      if (T.type === M.Element) {
        (fe = fe && !T.needBlock), delete T.needBlock;
        const q = ee.shadowRoot(s);
        q && ut(q) && (T.isShadowHost = !0);
      }
      if ((T.type === M.Document || T.type === M.Element) && fe) {
        p.headWhitespace && T.type === M.Element && T.tagName === "head" && (J = !1);
        const q = {
          doc: t,
          mirror: r,
          blockClass: i,
          blockSelector: o,
          needsMask: D,
          maskTextClass: n,
          maskTextSelector: a,
          skipChild: l,
          inlineStylesheet: u,
          maskInputOptions: c,
          maskTextFn: h,
          maskInputFn: f,
          slimDOMOptions: p,
          dataURLOptions: g,
          inlineImages: m,
          recordCanvas: d,
          preserveWhiteSpace: J,
          onSerialize: y,
          onIframeLoad: S,
          iframeLoadTimeout: w,
          onStylesheetLoad: v,
          stylesheetLoadTimeout: x,
          keepIframeSrcFn: N,
        };
        if (!(T.type === M.Element && T.tagName === "textarea" && T.attributes.value !== void 0))
          for (const U of Array.from(ee.childNodes(s))) {
            const ne = Ve(U, q);
            ne && T.childNodes.push(ne);
          }
        let ie = null;
        if (Ls(s) && (ie = ee.shadowRoot(s)))
          for (const U of Array.from(ee.childNodes(ie))) {
            const ne = Ve(U, q);
            ne && (ut(ie) && (ne.isShadow = !0), T.childNodes.push(ne));
          }
      }
      const Ae = ee.parentNode(s);
      return (
        Ae && lt(Ae) && ut(Ae) && (T.isShadow = !0),
        T.type === M.Element &&
          T.tagName === "iframe" &&
          Tl(
            s,
            () => {
              const q = s.contentDocument;
              if (q && S) {
                const ie = Ve(q, {
                  doc: q,
                  mirror: r,
                  blockClass: i,
                  blockSelector: o,
                  needsMask: D,
                  maskTextClass: n,
                  maskTextSelector: a,
                  skipChild: !1,
                  inlineStylesheet: u,
                  maskInputOptions: c,
                  maskTextFn: h,
                  maskInputFn: f,
                  slimDOMOptions: p,
                  dataURLOptions: g,
                  inlineImages: m,
                  recordCanvas: d,
                  preserveWhiteSpace: J,
                  onSerialize: y,
                  onIframeLoad: S,
                  iframeLoadTimeout: w,
                  onStylesheetLoad: v,
                  stylesheetLoadTimeout: x,
                  keepIframeSrcFn: N,
                });
                ie && S(s, ie);
              }
            },
            w,
          ),
        T.type === M.Element &&
          T.tagName === "link" &&
          typeof T.attributes.rel == "string" &&
          (T.attributes.rel === "stylesheet" ||
            (T.attributes.rel === "preload" &&
              typeof T.attributes.href == "string" &&
              Yn(T.attributes.href) === "css")) &&
          _l(
            s,
            () => {
              if (v) {
                const q = Ve(s, {
                  doc: t,
                  mirror: r,
                  blockClass: i,
                  blockSelector: o,
                  needsMask: D,
                  maskTextClass: n,
                  maskTextSelector: a,
                  skipChild: !1,
                  inlineStylesheet: u,
                  maskInputOptions: c,
                  maskTextFn: h,
                  maskInputFn: f,
                  slimDOMOptions: p,
                  dataURLOptions: g,
                  inlineImages: m,
                  recordCanvas: d,
                  preserveWhiteSpace: J,
                  onSerialize: y,
                  onIframeLoad: S,
                  iframeLoadTimeout: w,
                  onStylesheetLoad: v,
                  stylesheetLoadTimeout: x,
                  keepIframeSrcFn: N,
                });
                q && v(s, q);
              }
            },
            x,
          ),
        T
      );
    }
    function Bl(s, e) {
      const {
        mirror: t = new Fs(),
        blockClass: r = "rr-block",
        blockSelector: i = null,
        maskTextClass: o = "rr-mask",
        maskTextSelector: n = null,
        inlineStylesheet: a = !0,
        inlineImages: l = !1,
        recordCanvas: u = !1,
        maskAllInputs: c = !1,
        maskTextFn: h,
        maskInputFn: f,
        slimDOM: p = !1,
        dataURLOptions: g,
        preserveWhiteSpace: m,
        onSerialize: d,
        onIframeLoad: y,
        iframeLoadTimeout: S,
        onStylesheetLoad: w,
        stylesheetLoadTimeout: v,
        keepIframeSrcFn: x = () => !1,
      } = e || {};
      return Ve(s, {
        doc: s,
        mirror: t,
        blockClass: r,
        blockSelector: i,
        maskTextClass: o,
        maskTextSelector: n,
        skipChild: !1,
        inlineStylesheet: a,
        maskInputOptions:
          c === !0
            ? {
                color: !0,
                date: !0,
                "datetime-local": !0,
                email: !0,
                month: !0,
                number: !0,
                range: !0,
                search: !0,
                tel: !0,
                text: !0,
                time: !0,
                url: !0,
                week: !0,
                textarea: !0,
                select: !0,
                password: !0,
              }
            : c === !1
            ? { password: !0 }
            : c,
        maskTextFn: h,
        maskInputFn: f,
        slimDOMOptions:
          p === !0 || p === "all"
            ? {
                script: !0,
                comment: !0,
                headFavicon: !0,
                headWhitespace: !0,
                headMetaDescKeywords: p === "all",
                headMetaSocial: !0,
                headMetaRobots: !0,
                headMetaHttpEquiv: !0,
                headMetaAuthorship: !0,
                headMetaVerification: !0,
              }
            : p === !1
            ? {}
            : p,
        dataURLOptions: g,
        inlineImages: l,
        recordCanvas: u,
        preserveWhiteSpace: m,
        onSerialize: d,
        onIframeLoad: y,
        iframeLoadTimeout: S,
        onStylesheetLoad: w,
        stylesheetLoadTimeout: v,
        keepIframeSrcFn: x,
        newlyAddedElement: !1,
      });
    }
    const Ul = /(max|min)-device-(width|height)/,
      Li = new RegExp(Ul.source, "g"),
      Wl = {
        postcssPlugin: "postcss-custom-selectors",
        prepare() {
          return {
            postcssPlugin: "postcss-custom-selectors",
            AtRule: function (s) {
              s.params.match(Li) && (s.params = s.params.replace(Li, "$1-$2"));
            },
          };
        },
      },
      zl = {
        postcssPlugin: "postcss-hover-classes",
        prepare: function () {
          const s = [];
          return {
            Rule: function (e) {
              s.indexOf(e) === -1 &&
                (s.push(e),
                e.selectors.forEach(function (t) {
                  if (!t.includes(":")) return;
                  const r = t.replace(/\n/g, " ").split(" "),
                    i = [];
                  r.forEach(function (n) {
                    const a = n.match(/::?([^:]+)/g);
                    if (!a) {
                      i.push(n);
                      return;
                    }
                    const l = n.substr(0, n.length - a.join("").length),
                      u = a.map(function (c) {
                        return c.replace(/\(.*/g, "") !== ":hover" || c.match(/^::/)
                          ? c
                          : ((c = c.substr(1)),
                            (c = c.replace(/\(/g, "\\(")),
                            (c = c.replace(/\)/g, "\\)")),
                            ".\\:" + c);
                      });
                    i.push(l + u.join(""));
                  }),
                    o(i.join(" "));
                  function o(n) {
                    n &&
                      n !== t &&
                      (e.selector +=
                        `,
` + n);
                  }
                }));
            },
          };
        },
      };
    function Vl(s) {
      return s && s.__esModule && Object.prototype.hasOwnProperty.call(s, "default") ? s.default : s;
    }
    function Gl(s) {
      if (s.__esModule) return s;
      var e = s.default;
      if (typeof e == "function") {
        var t = function r() {
          return this instanceof r ? Reflect.construct(e, arguments, this.constructor) : e.apply(this, arguments);
        };
        t.prototype = e.prototype;
      } else t = {};
      return (
        Object.defineProperty(t, "__esModule", { value: !0 }),
        Object.keys(s).forEach(function (r) {
          var i = Object.getOwnPropertyDescriptor(s, r);
          Object.defineProperty(
            t,
            r,
            i.get
              ? i
              : {
                  enumerable: !0,
                  get: function () {
                    return s[r];
                  },
                },
          );
        }),
        t
      );
    }
    var zs = { exports: {} },
      V = String,
      Kn = function () {
        return {
          isColorSupported: !1,
          reset: V,
          bold: V,
          dim: V,
          italic: V,
          underline: V,
          inverse: V,
          hidden: V,
          strikethrough: V,
          black: V,
          red: V,
          green: V,
          yellow: V,
          blue: V,
          magenta: V,
          cyan: V,
          white: V,
          gray: V,
          bgBlack: V,
          bgRed: V,
          bgGreen: V,
          bgYellow: V,
          bgBlue: V,
          bgMagenta: V,
          bgCyan: V,
          bgWhite: V,
        };
      };
    zs.exports = Kn();
    zs.exports.createColors = Kn;
    var jl = zs.exports;
    const Yl = {},
      Hl = Object.freeze(
        Object.defineProperty({ __proto__: null, default: Yl }, Symbol.toStringTag, { value: "Module" }),
      ),
      ue = Gl(Hl);
    let Fi = jl,
      Bi = ue,
      ts = class Qn extends Error {
        constructor(e, t, r, i, o, n) {
          super(e),
            (this.name = "CssSyntaxError"),
            (this.reason = e),
            o && (this.file = o),
            i && (this.source = i),
            n && (this.plugin = n),
            typeof t != "undefined" &&
              typeof r != "undefined" &&
              (typeof t == "number"
                ? ((this.line = t), (this.column = r))
                : ((this.line = t.line),
                  (this.column = t.column),
                  (this.endLine = r.line),
                  (this.endColumn = r.column))),
            this.setMessage(),
            Error.captureStackTrace && Error.captureStackTrace(this, Qn);
        }
        setMessage() {
          (this.message = this.plugin ? this.plugin + ": " : ""),
            (this.message += this.file ? this.file : "<css input>"),
            typeof this.line != "undefined" && (this.message += ":" + this.line + ":" + this.column),
            (this.message += ": " + this.reason);
        }
        showSourceCode(e) {
          if (!this.source) return "";
          let t = this.source;
          e == null && (e = Fi.isColorSupported), Bi && e && (t = Bi(t));
          let r = t.split(/\r?\n/),
            i = Math.max(this.line - 3, 0),
            o = Math.min(this.line + 2, r.length),
            n = String(o).length,
            a,
            l;
          if (e) {
            let { bold: u, gray: c, red: h } = Fi.createColors(!0);
            (a = (f) => u(h(f))), (l = (f) => c(f));
          } else a = l = (u) => u;
          return r.slice(i, o).map((u, c) => {
            let h = i + 1 + c,
              f = " " + (" " + h).slice(-n) + " | ";
            if (h === this.line) {
              let p = l(f.replace(/\d/g, " ")) + u.slice(0, this.column - 1).replace(/[^\t]/g, " ");
              return (
                a(">") +
                l(f) +
                u +
                `
` +
                p +
                a("^")
              );
            }
            return " " + l(f) + u;
          }).join(`
`);
        }
        toString() {
          let e = this.showSourceCode();
          return (
            e &&
              (e =
                `

` +
                e +
                `
`),
            this.name + ": " + this.message + e
          );
        }
      };
    var Vs = ts;
    ts.default = ts;
    var Ct = {};
    Ct.isClean = Symbol("isClean");
    Ct.my = Symbol("my");
    const Ui = {
      after: `
`,
      beforeClose: `
`,
      beforeComment: `
`,
      beforeDecl: `
`,
      beforeOpen: " ",
      beforeRule: `
`,
      colon: ": ",
      commentLeft: " ",
      commentRight: " ",
      emptyBody: "",
      indent: "    ",
      semicolon: !1,
    };
    function Zl(s) {
      return s[0].toUpperCase() + s.slice(1);
    }
    let rs = class {
      constructor(e) {
        this.builder = e;
      }
      atrule(e, t) {
        let r = "@" + e.name,
          i = e.params ? this.rawValue(e, "params") : "";
        if ((typeof e.raws.afterName != "undefined" ? (r += e.raws.afterName) : i && (r += " "), e.nodes))
          this.block(e, r + i);
        else {
          let o = (e.raws.between || "") + (t ? ";" : "");
          this.builder(r + i + o, e);
        }
      }
      beforeAfter(e, t) {
        let r;
        e.type === "decl"
          ? (r = this.raw(e, null, "beforeDecl"))
          : e.type === "comment"
          ? (r = this.raw(e, null, "beforeComment"))
          : t === "before"
          ? (r = this.raw(e, null, "beforeRule"))
          : (r = this.raw(e, null, "beforeClose"));
        let i = e.parent,
          o = 0;
        for (; i && i.type !== "root"; ) (o += 1), (i = i.parent);
        if (
          r.includes(`
`)
        ) {
          let n = this.raw(e, null, "indent");
          if (n.length) for (let a = 0; a < o; a++) r += n;
        }
        return r;
      }
      block(e, t) {
        let r = this.raw(e, "between", "beforeOpen");
        this.builder(t + r + "{", e, "start");
        let i;
        e.nodes && e.nodes.length
          ? (this.body(e), (i = this.raw(e, "after")))
          : (i = this.raw(e, "after", "emptyBody")),
          i && this.builder(i),
          this.builder("}", e, "end");
      }
      body(e) {
        let t = e.nodes.length - 1;
        for (; t > 0 && e.nodes[t].type === "comment"; ) t -= 1;
        let r = this.raw(e, "semicolon");
        for (let i = 0; i < e.nodes.length; i++) {
          let o = e.nodes[i],
            n = this.raw(o, "before");
          n && this.builder(n), this.stringify(o, t !== i || r);
        }
      }
      comment(e) {
        let t = this.raw(e, "left", "commentLeft"),
          r = this.raw(e, "right", "commentRight");
        this.builder("/*" + t + e.text + r + "*/", e);
      }
      decl(e, t) {
        let r = this.raw(e, "between", "colon"),
          i = e.prop + r + this.rawValue(e, "value");
        e.important && (i += e.raws.important || " !important"), t && (i += ";"), this.builder(i, e);
      }
      document(e) {
        this.body(e);
      }
      raw(e, t, r) {
        let i;
        if ((r || (r = t), t && ((i = e.raws[t]), typeof i != "undefined"))) return i;
        let o = e.parent;
        if (r === "before" && (!o || (o.type === "root" && o.first === e) || (o && o.type === "document"))) return "";
        if (!o) return Ui[r];
        let n = e.root();
        if ((n.rawCache || (n.rawCache = {}), typeof n.rawCache[r] != "undefined")) return n.rawCache[r];
        if (r === "before" || r === "after") return this.beforeAfter(e, r);
        {
          let a = "raw" + Zl(r);
          this[a]
            ? (i = this[a](n, e))
            : n.walk((l) => {
                if (((i = l.raws[t]), typeof i != "undefined")) return !1;
              });
        }
        return typeof i == "undefined" && (i = Ui[r]), (n.rawCache[r] = i), i;
      }
      rawBeforeClose(e) {
        let t;
        return (
          e.walk((r) => {
            if (r.nodes && r.nodes.length > 0 && typeof r.raws.after != "undefined")
              return (
                (t = r.raws.after),
                t.includes(`
`) && (t = t.replace(/[^\n]+$/, "")),
                !1
              );
          }),
          t && (t = t.replace(/\S/g, "")),
          t
        );
      }
      rawBeforeComment(e, t) {
        let r;
        return (
          e.walkComments((i) => {
            if (typeof i.raws.before != "undefined")
              return (
                (r = i.raws.before),
                r.includes(`
`) && (r = r.replace(/[^\n]+$/, "")),
                !1
              );
          }),
          typeof r == "undefined" ? (r = this.raw(t, null, "beforeDecl")) : r && (r = r.replace(/\S/g, "")),
          r
        );
      }
      rawBeforeDecl(e, t) {
        let r;
        return (
          e.walkDecls((i) => {
            if (typeof i.raws.before != "undefined")
              return (
                (r = i.raws.before),
                r.includes(`
`) && (r = r.replace(/[^\n]+$/, "")),
                !1
              );
          }),
          typeof r == "undefined" ? (r = this.raw(t, null, "beforeRule")) : r && (r = r.replace(/\S/g, "")),
          r
        );
      }
      rawBeforeOpen(e) {
        let t;
        return (
          e.walk((r) => {
            if (r.type !== "decl" && ((t = r.raws.between), typeof t != "undefined")) return !1;
          }),
          t
        );
      }
      rawBeforeRule(e) {
        let t;
        return (
          e.walk((r) => {
            if (r.nodes && (r.parent !== e || e.first !== r) && typeof r.raws.before != "undefined")
              return (
                (t = r.raws.before),
                t.includes(`
`) && (t = t.replace(/[^\n]+$/, "")),
                !1
              );
          }),
          t && (t = t.replace(/\S/g, "")),
          t
        );
      }
      rawColon(e) {
        let t;
        return (
          e.walkDecls((r) => {
            if (typeof r.raws.between != "undefined") return (t = r.raws.between.replace(/[^\s:]/g, "")), !1;
          }),
          t
        );
      }
      rawEmptyBody(e) {
        let t;
        return (
          e.walk((r) => {
            if (r.nodes && r.nodes.length === 0 && ((t = r.raws.after), typeof t != "undefined")) return !1;
          }),
          t
        );
      }
      rawIndent(e) {
        if (e.raws.indent) return e.raws.indent;
        let t;
        return (
          e.walk((r) => {
            let i = r.parent;
            if (i && i !== e && i.parent && i.parent === e && typeof r.raws.before != "undefined") {
              let o = r.raws.before.split(`
`);
              return (t = o[o.length - 1]), (t = t.replace(/\S/g, "")), !1;
            }
          }),
          t
        );
      }
      rawSemicolon(e) {
        let t;
        return (
          e.walk((r) => {
            if (
              r.nodes &&
              r.nodes.length &&
              r.last.type === "decl" &&
              ((t = r.raws.semicolon), typeof t != "undefined")
            )
              return !1;
          }),
          t
        );
      }
      rawValue(e, t) {
        let r = e[t],
          i = e.raws[t];
        return i && i.value === r ? i.raw : r;
      }
      root(e) {
        this.body(e), e.raws.after && this.builder(e.raws.after);
      }
      rule(e) {
        this.block(e, this.rawValue(e, "selector")), e.raws.ownSemicolon && this.builder(e.raws.ownSemicolon, e, "end");
      }
      stringify(e, t) {
        if (!this[e.type])
          throw new Error("Unknown AST node type " + e.type + ". Maybe you need to change PostCSS stringifier.");
        this[e.type](e, t);
      }
    };
    var qn = rs;
    rs.default = rs;
    let Xl = qn;
    function ss(s, e) {
      new Xl(e).stringify(s);
    }
    var xr = ss;
    ss.default = ss;
    let { isClean: Tt, my: Jl } = Ct,
      Kl = Vs,
      Ql = qn,
      ql = xr;
    function is(s, e) {
      let t = new s.constructor();
      for (let r in s) {
        if (!Object.prototype.hasOwnProperty.call(s, r) || r === "proxyCache") continue;
        let i = s[r],
          o = typeof i;
        r === "parent" && o === "object"
          ? e && (t[r] = e)
          : r === "source"
          ? (t[r] = i)
          : Array.isArray(i)
          ? (t[r] = i.map((n) => is(n, t)))
          : (o === "object" && i !== null && (i = is(i)), (t[r] = i));
      }
      return t;
    }
    let ns = class {
      constructor(e = {}) {
        (this.raws = {}), (this[Tt] = !1), (this[Jl] = !0);
        for (let t in e)
          if (t === "nodes") {
            this.nodes = [];
            for (let r of e[t]) typeof r.clone == "function" ? this.append(r.clone()) : this.append(r);
          } else this[t] = e[t];
      }
      addToError(e) {
        if (((e.postcssNode = this), e.stack && this.source && /\n\s{4}at /.test(e.stack))) {
          let t = this.source;
          e.stack = e.stack.replace(/\n\s{4}at /, `$&${t.input.from}:${t.start.line}:${t.start.column}$&`);
        }
        return e;
      }
      after(e) {
        return this.parent.insertAfter(this, e), this;
      }
      assign(e = {}) {
        for (let t in e) this[t] = e[t];
        return this;
      }
      before(e) {
        return this.parent.insertBefore(this, e), this;
      }
      cleanRaws(e) {
        delete this.raws.before, delete this.raws.after, e || delete this.raws.between;
      }
      clone(e = {}) {
        let t = is(this);
        for (let r in e) t[r] = e[r];
        return t;
      }
      cloneAfter(e = {}) {
        let t = this.clone(e);
        return this.parent.insertAfter(this, t), t;
      }
      cloneBefore(e = {}) {
        let t = this.clone(e);
        return this.parent.insertBefore(this, t), t;
      }
      error(e, t = {}) {
        if (this.source) {
          let { end: r, start: i } = this.rangeBy(t);
          return this.source.input.error(e, { column: i.column, line: i.line }, { column: r.column, line: r.line }, t);
        }
        return new Kl(e);
      }
      getProxyProcessor() {
        return {
          get(e, t) {
            return t === "proxyOf" ? e : t === "root" ? () => e.root().toProxy() : e[t];
          },
          set(e, t, r) {
            return (
              e[t] === r ||
                ((e[t] = r),
                (t === "prop" ||
                  t === "value" ||
                  t === "name" ||
                  t === "params" ||
                  t === "important" ||
                  t === "text") &&
                  e.markDirty()),
              !0
            );
          },
        };
      }
      markDirty() {
        if (this[Tt]) {
          this[Tt] = !1;
          let e = this;
          for (; (e = e.parent); ) e[Tt] = !1;
        }
      }
      next() {
        if (!this.parent) return;
        let e = this.parent.index(this);
        return this.parent.nodes[e + 1];
      }
      positionBy(e, t) {
        let r = this.source.start;
        if (e.index) r = this.positionInside(e.index, t);
        else if (e.word) {
          t = this.toString();
          let i = t.indexOf(e.word);
          i !== -1 && (r = this.positionInside(i, t));
        }
        return r;
      }
      positionInside(e, t) {
        let r = t || this.toString(),
          i = this.source.start.column,
          o = this.source.start.line;
        for (let n = 0; n < e; n++)
          r[n] ===
          `
`
            ? ((i = 1), (o += 1))
            : (i += 1);
        return { column: i, line: o };
      }
      prev() {
        if (!this.parent) return;
        let e = this.parent.index(this);
        return this.parent.nodes[e - 1];
      }
      rangeBy(e) {
        let t = {
            column: this.source.start.column,
            line: this.source.start.line,
          },
          r = this.source.end
            ? { column: this.source.end.column + 1, line: this.source.end.line }
            : { column: t.column + 1, line: t.line };
        if (e.word) {
          let i = this.toString(),
            o = i.indexOf(e.word);
          o !== -1 && ((t = this.positionInside(o, i)), (r = this.positionInside(o + e.word.length, i)));
        } else
          e.start
            ? (t = { column: e.start.column, line: e.start.line })
            : e.index && (t = this.positionInside(e.index)),
            e.end
              ? (r = { column: e.end.column, line: e.end.line })
              : typeof e.endIndex == "number"
              ? (r = this.positionInside(e.endIndex))
              : e.index && (r = this.positionInside(e.index + 1));
        return (
          (r.line < t.line || (r.line === t.line && r.column <= t.column)) &&
            (r = { column: t.column + 1, line: t.line }),
          { end: r, start: t }
        );
      }
      raw(e, t) {
        return new Ql().raw(this, e, t);
      }
      remove() {
        return this.parent && this.parent.removeChild(this), (this.parent = void 0), this;
      }
      replaceWith(...e) {
        if (this.parent) {
          let t = this,
            r = !1;
          for (let i of e)
            i === this ? (r = !0) : r ? (this.parent.insertAfter(t, i), (t = i)) : this.parent.insertBefore(t, i);
          r || this.remove();
        }
        return this;
      }
      root() {
        let e = this;
        for (; e.parent && e.parent.type !== "document"; ) e = e.parent;
        return e;
      }
      toJSON(e, t) {
        let r = {},
          i = t == null;
        t = t || new Map();
        let o = 0;
        for (let n in this) {
          if (!Object.prototype.hasOwnProperty.call(this, n) || n === "parent" || n === "proxyCache") continue;
          let a = this[n];
          if (Array.isArray(a)) r[n] = a.map((l) => (typeof l == "object" && l.toJSON ? l.toJSON(null, t) : l));
          else if (typeof a == "object" && a.toJSON) r[n] = a.toJSON(null, t);
          else if (n === "source") {
            let l = t.get(a.input);
            l == null && ((l = o), t.set(a.input, o), o++), (r[n] = { end: a.end, inputId: l, start: a.start });
          } else r[n] = a;
        }
        return i && (r.inputs = [...t.keys()].map((n) => n.toJSON())), r;
      }
      toProxy() {
        return this.proxyCache || (this.proxyCache = new Proxy(this, this.getProxyProcessor())), this.proxyCache;
      }
      toString(e = ql) {
        e.stringify && (e = e.stringify);
        let t = "";
        return (
          e(this, (r) => {
            t += r;
          }),
          t
        );
      }
      warn(e, t, r) {
        let i = { node: this };
        for (let o in r) i[o] = r[o];
        return e.warn(t, i);
      }
      get proxyOf() {
        return this;
      }
    };
    var Mr = ns;
    ns.default = ns;
    let eu = Mr,
      os = class extends eu {
        constructor(e) {
          e &&
            typeof e.value != "undefined" &&
            typeof e.value != "string" &&
            (e = Q(R({}, e), { value: String(e.value) })),
            super(e),
            (this.type = "decl");
        }
        get variable() {
          return this.prop.startsWith("--") || this.prop[0] === "$";
        }
      };
    var Rr = os;
    os.default = os;
    let tu = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict",
      ru =
        (s, e = 21) =>
        (t = e) => {
          let r = "",
            i = t;
          for (; i--; ) r += s[(Math.random() * s.length) | 0];
          return r;
        },
      su = (s = 21) => {
        let e = "",
          t = s;
        for (; t--; ) e += tu[(Math.random() * 64) | 0];
        return e;
      };
    var iu = { nanoid: su, customAlphabet: ru };
    let { SourceMapConsumer: Wi, SourceMapGenerator: zi } = ue,
      { existsSync: nu, readFileSync: ou } = ue,
      { dirname: zr, join: au } = ue;
    function lu(s) {
      return Buffer ? Buffer.from(s, "base64").toString() : window.atob(s);
    }
    let as = class {
      constructor(e, t) {
        if (t.map === !1) return;
        this.loadAnnotation(e), (this.inline = this.startWith(this.annotation, "data:"));
        let r = t.map ? t.map.prev : void 0,
          i = this.loadMap(t.from, r);
        !this.mapFile && t.from && (this.mapFile = t.from),
          this.mapFile && (this.root = zr(this.mapFile)),
          i && (this.text = i);
      }
      consumer() {
        return this.consumerCache || (this.consumerCache = new Wi(this.text)), this.consumerCache;
      }
      decodeInline(e) {
        let t = /^data:application\/json;charset=utf-?8;base64,/,
          r = /^data:application\/json;base64,/,
          i = /^data:application\/json;charset=utf-?8,/,
          o = /^data:application\/json,/;
        if (i.test(e) || o.test(e)) return decodeURIComponent(e.substr(RegExp.lastMatch.length));
        if (t.test(e) || r.test(e)) return lu(e.substr(RegExp.lastMatch.length));
        let n = e.match(/data:application\/json;([^,]+),/)[1];
        throw new Error("Unsupported source map encoding " + n);
      }
      getAnnotationURL(e) {
        return e.replace(/^\/\*\s*# sourceMappingURL=/, "").trim();
      }
      isMap(e) {
        return typeof e != "object"
          ? !1
          : typeof e.mappings == "string" || typeof e._mappings == "string" || Array.isArray(e.sections);
      }
      loadAnnotation(e) {
        let t = e.match(/\/\*\s*# sourceMappingURL=/gm);
        if (!t) return;
        let r = e.lastIndexOf(t.pop()),
          i = e.indexOf("*/", r);
        r > -1 && i > -1 && (this.annotation = this.getAnnotationURL(e.substring(r, i)));
      }
      loadFile(e) {
        if (((this.root = zr(e)), nu(e))) return (this.mapFile = e), ou(e, "utf-8").toString().trim();
      }
      loadMap(e, t) {
        if (t === !1) return !1;
        if (t) {
          if (typeof t == "string") return t;
          if (typeof t == "function") {
            let r = t(e);
            if (r) {
              let i = this.loadFile(r);
              if (!i) throw new Error("Unable to load previous source map: " + r.toString());
              return i;
            }
          } else {
            if (t instanceof Wi) return zi.fromSourceMap(t).toString();
            if (t instanceof zi) return t.toString();
            if (this.isMap(t)) return JSON.stringify(t);
            throw new Error("Unsupported previous source map format: " + t.toString());
          }
        } else {
          if (this.inline) return this.decodeInline(this.annotation);
          if (this.annotation) {
            let r = this.annotation;
            return e && (r = au(zr(e), r)), this.loadFile(r);
          }
        }
      }
      startWith(e, t) {
        return e ? e.substr(0, t.length) === t : !1;
      }
      withContent() {
        return !!(this.consumer().sourcesContent && this.consumer().sourcesContent.length > 0);
      }
    };
    var eo = as;
    as.default = as;
    let { SourceMapConsumer: uu, SourceMapGenerator: cu } = ue,
      { fileURLToPath: Vi, pathToFileURL: _t } = ue,
      { isAbsolute: ls, resolve: us } = ue,
      { nanoid: hu } = iu,
      Vr = ue,
      Gi = Vs,
      fu = eo,
      Gr = Symbol("fromOffsetCache"),
      du = !!(uu && cu),
      ji = !!(us && ls),
      hr = class {
        constructor(e, t = {}) {
          if (e === null || typeof e == "undefined" || (typeof e == "object" && !e.toString))
            throw new Error(`PostCSS received ${e} instead of CSS string`);
          if (
            ((this.css = e.toString()),
            this.css[0] === "\uFEFF" || this.css[0] === "\uFFFE"
              ? ((this.hasBOM = !0), (this.css = this.css.slice(1)))
              : (this.hasBOM = !1),
            t.from && (!ji || /^\w+:\/\//.test(t.from) || ls(t.from) ? (this.file = t.from) : (this.file = us(t.from))),
            ji && du)
          ) {
            let r = new fu(this.css, t);
            if (r.text) {
              this.map = r;
              let i = r.consumer().file;
              !this.file && i && (this.file = this.mapResolve(i));
            }
          }
          this.file || (this.id = "<input css " + hu(6) + ">"), this.map && (this.map.file = this.from);
        }
        error(e, t, r, i = {}) {
          let o, n, a;
          if (t && typeof t == "object") {
            let u = t,
              c = r;
            if (typeof u.offset == "number") {
              let h = this.fromOffset(u.offset);
              (t = h.line), (r = h.col);
            } else (t = u.line), (r = u.column);
            if (typeof c.offset == "number") {
              let h = this.fromOffset(c.offset);
              (n = h.line), (a = h.col);
            } else (n = c.line), (a = c.column);
          } else if (!r) {
            let u = this.fromOffset(t);
            (t = u.line), (r = u.col);
          }
          let l = this.origin(t, r, n, a);
          return (
            l
              ? (o = new Gi(
                  e,
                  l.endLine === void 0 ? l.line : { column: l.column, line: l.line },
                  l.endLine === void 0 ? l.column : { column: l.endColumn, line: l.endLine },
                  l.source,
                  l.file,
                  i.plugin,
                ))
              : (o = new Gi(
                  e,
                  n === void 0 ? t : { column: r, line: t },
                  n === void 0 ? r : { column: a, line: n },
                  this.css,
                  this.file,
                  i.plugin,
                )),
            (o.input = {
              column: r,
              endColumn: a,
              endLine: n,
              line: t,
              source: this.css,
            }),
            this.file && (_t && (o.input.url = _t(this.file).toString()), (o.input.file = this.file)),
            o
          );
        }
        fromOffset(e) {
          let t, r;
          if (this[Gr]) r = this[Gr];
          else {
            let o = this.css.split(`
`);
            r = new Array(o.length);
            let n = 0;
            for (let a = 0, l = o.length; a < l; a++) (r[a] = n), (n += o[a].length + 1);
            this[Gr] = r;
          }
          t = r[r.length - 1];
          let i = 0;
          if (e >= t) i = r.length - 1;
          else {
            let o = r.length - 2,
              n;
            for (; i < o; )
              if (((n = i + ((o - i) >> 1)), e < r[n])) o = n - 1;
              else if (e >= r[n + 1]) i = n + 1;
              else {
                i = n;
                break;
              }
          }
          return { col: e - r[i] + 1, line: i + 1 };
        }
        mapResolve(e) {
          return /^\w+:\/\//.test(e) ? e : us(this.map.consumer().sourceRoot || this.map.root || ".", e);
        }
        origin(e, t, r, i) {
          if (!this.map) return !1;
          let o = this.map.consumer(),
            n = o.originalPositionFor({ column: t, line: e });
          if (!n.source) return !1;
          let a;
          typeof r == "number" && (a = o.originalPositionFor({ column: i, line: r }));
          let l;
          ls(n.source)
            ? (l = _t(n.source))
            : (l = new URL(n.source, this.map.consumer().sourceRoot || _t(this.map.mapFile)));
          let u = {
            column: n.column,
            endColumn: a && a.column,
            endLine: a && a.line,
            line: n.line,
            url: l.toString(),
          };
          if (l.protocol === "file:")
            if (Vi) u.file = Vi(l);
            else throw new Error("file: protocol is not available in this PostCSS build");
          let c = o.sourceContentFor(n.source);
          return c && (u.source = c), u;
        }
        toJSON() {
          let e = {};
          for (let t of ["hasBOM", "css", "file", "id"]) this[t] != null && (e[t] = this[t]);
          return this.map && ((e.map = R({}, this.map)), e.map.consumerCache && (e.map.consumerCache = void 0)), e;
        }
        get from() {
          return this.file || this.id;
        }
      };
    var Nr = hr;
    hr.default = hr;
    Vr && Vr.registerInput && Vr.registerInput(hr);
    let { SourceMapConsumer: to, SourceMapGenerator: tr } = ue,
      { dirname: rr, relative: ro, resolve: so, sep: io } = ue,
      { pathToFileURL: Yi } = ue,
      pu = Nr,
      mu = !!(to && tr),
      gu = !!(rr && so && ro && io),
      yu = class {
        constructor(e, t, r, i) {
          (this.stringify = e),
            (this.mapOpts = r.map || {}),
            (this.root = t),
            (this.opts = r),
            (this.css = i),
            (this.originalCSS = i),
            (this.usesFileUrls = !this.mapOpts.from && this.mapOpts.absolute),
            (this.memoizedFileURLs = new Map()),
            (this.memoizedPaths = new Map()),
            (this.memoizedURLs = new Map());
        }
        addAnnotation() {
          let e;
          this.isInline()
            ? (e = "data:application/json;base64," + this.toBase64(this.map.toString()))
            : typeof this.mapOpts.annotation == "string"
            ? (e = this.mapOpts.annotation)
            : typeof this.mapOpts.annotation == "function"
            ? (e = this.mapOpts.annotation(this.opts.to, this.root))
            : (e = this.outputFile() + ".map");
          let t = `
`;
          this.css.includes(`\r
`) &&
            (t = `\r
`),
            (this.css += t + "/*# sourceMappingURL=" + e + " */");
        }
        applyPrevMaps() {
          for (let e of this.previous()) {
            let t = this.toUrl(this.path(e.file)),
              r = e.root || rr(e.file),
              i;
            this.mapOpts.sourcesContent === !1
              ? ((i = new to(e.text)), i.sourcesContent && (i.sourcesContent = null))
              : (i = e.consumer()),
              this.map.applySourceMap(i, t, this.toUrl(this.path(r)));
          }
        }
        clearAnnotation() {
          if (this.mapOpts.annotation !== !1)
            if (this.root) {
              let e;
              for (let t = this.root.nodes.length - 1; t >= 0; t--)
                (e = this.root.nodes[t]),
                  e.type === "comment" && e.text.indexOf("# sourceMappingURL=") === 0 && this.root.removeChild(t);
            } else this.css && (this.css = this.css.replace(/\n*?\/\*#[\S\s]*?\*\/$/gm, ""));
        }
        generate() {
          if ((this.clearAnnotation(), gu && mu && this.isMap())) return this.generateMap();
          {
            let e = "";
            return (
              this.stringify(this.root, (t) => {
                e += t;
              }),
              [e]
            );
          }
        }
        generateMap() {
          if (this.root) this.generateString();
          else if (this.previous().length === 1) {
            let e = this.previous()[0].consumer();
            (e.file = this.outputFile()), (this.map = tr.fromSourceMap(e, { ignoreInvalidMapping: !0 }));
          } else
            (this.map = new tr({
              file: this.outputFile(),
              ignoreInvalidMapping: !0,
            })),
              this.map.addMapping({
                generated: { column: 0, line: 1 },
                original: { column: 0, line: 1 },
                source: this.opts.from ? this.toUrl(this.path(this.opts.from)) : "<no source>",
              });
          return (
            this.isSourcesContent() && this.setSourcesContent(),
            this.root && this.previous().length > 0 && this.applyPrevMaps(),
            this.isAnnotation() && this.addAnnotation(),
            this.isInline() ? [this.css] : [this.css, this.map]
          );
        }
        generateString() {
          (this.css = ""),
            (this.map = new tr({
              file: this.outputFile(),
              ignoreInvalidMapping: !0,
            }));
          let e = 1,
            t = 1,
            r = "<no source>",
            i = {
              generated: { column: 0, line: 0 },
              original: { column: 0, line: 0 },
              source: "",
            },
            o,
            n;
          this.stringify(this.root, (a, l, u) => {
            if (
              ((this.css += a),
              l &&
                u !== "end" &&
                ((i.generated.line = e),
                (i.generated.column = t - 1),
                l.source && l.source.start
                  ? ((i.source = this.sourcePath(l)),
                    (i.original.line = l.source.start.line),
                    (i.original.column = l.source.start.column - 1),
                    this.map.addMapping(i))
                  : ((i.source = r), (i.original.line = 1), (i.original.column = 0), this.map.addMapping(i))),
              (o = a.match(/\n/g)),
              o
                ? ((e += o.length),
                  (n = a.lastIndexOf(`
`)),
                  (t = a.length - n))
                : (t += a.length),
              l && u !== "start")
            ) {
              let c = l.parent || { raws: {} };
              (!(l.type === "decl" || (l.type === "atrule" && !l.nodes)) || l !== c.last || c.raws.semicolon) &&
                (l.source && l.source.end
                  ? ((i.source = this.sourcePath(l)),
                    (i.original.line = l.source.end.line),
                    (i.original.column = l.source.end.column - 1),
                    (i.generated.line = e),
                    (i.generated.column = t - 2),
                    this.map.addMapping(i))
                  : ((i.source = r),
                    (i.original.line = 1),
                    (i.original.column = 0),
                    (i.generated.line = e),
                    (i.generated.column = t - 1),
                    this.map.addMapping(i)));
            }
          });
        }
        isAnnotation() {
          return this.isInline()
            ? !0
            : typeof this.mapOpts.annotation != "undefined"
            ? this.mapOpts.annotation
            : this.previous().length
            ? this.previous().some((e) => e.annotation)
            : !0;
        }
        isInline() {
          if (typeof this.mapOpts.inline != "undefined") return this.mapOpts.inline;
          let e = this.mapOpts.annotation;
          return typeof e != "undefined" && e !== !0
            ? !1
            : this.previous().length
            ? this.previous().some((t) => t.inline)
            : !0;
        }
        isMap() {
          return typeof this.opts.map != "undefined" ? !!this.opts.map : this.previous().length > 0;
        }
        isSourcesContent() {
          return typeof this.mapOpts.sourcesContent != "undefined"
            ? this.mapOpts.sourcesContent
            : this.previous().length
            ? this.previous().some((e) => e.withContent())
            : !0;
        }
        outputFile() {
          return this.opts.to ? this.path(this.opts.to) : this.opts.from ? this.path(this.opts.from) : "to.css";
        }
        path(e) {
          if (this.mapOpts.absolute || e.charCodeAt(0) === 60 || /^\w+:\/\//.test(e)) return e;
          let t = this.memoizedPaths.get(e);
          if (t) return t;
          let r = this.opts.to ? rr(this.opts.to) : ".";
          typeof this.mapOpts.annotation == "string" && (r = rr(so(r, this.mapOpts.annotation)));
          let i = ro(r, e);
          return this.memoizedPaths.set(e, i), i;
        }
        previous() {
          if (!this.previousMaps)
            if (((this.previousMaps = []), this.root))
              this.root.walk((e) => {
                if (e.source && e.source.input.map) {
                  let t = e.source.input.map;
                  this.previousMaps.includes(t) || this.previousMaps.push(t);
                }
              });
            else {
              let e = new pu(this.originalCSS, this.opts);
              e.map && this.previousMaps.push(e.map);
            }
          return this.previousMaps;
        }
        setSourcesContent() {
          let e = {};
          if (this.root)
            this.root.walk((t) => {
              if (t.source) {
                let r = t.source.input.from;
                if (r && !e[r]) {
                  e[r] = !0;
                  let i = this.usesFileUrls ? this.toFileUrl(r) : this.toUrl(this.path(r));
                  this.map.setSourceContent(i, t.source.input.css);
                }
              }
            });
          else if (this.css) {
            let t = this.opts.from ? this.toUrl(this.path(this.opts.from)) : "<no source>";
            this.map.setSourceContent(t, this.css);
          }
        }
        sourcePath(e) {
          return this.mapOpts.from
            ? this.toUrl(this.mapOpts.from)
            : this.usesFileUrls
            ? this.toFileUrl(e.source.input.from)
            : this.toUrl(this.path(e.source.input.from));
        }
        toBase64(e) {
          return Buffer ? Buffer.from(e).toString("base64") : window.btoa(unescape(encodeURIComponent(e)));
        }
        toFileUrl(e) {
          let t = this.memoizedFileURLs.get(e);
          if (t) return t;
          if (Yi) {
            let r = Yi(e).toString();
            return this.memoizedFileURLs.set(e, r), r;
          } else throw new Error("`map.absolute` option is not available in this PostCSS build");
        }
        toUrl(e) {
          let t = this.memoizedURLs.get(e);
          if (t) return t;
          io === "\\" && (e = e.replace(/\\/g, "/"));
          let r = encodeURI(e).replace(/[#?]/g, encodeURIComponent);
          return this.memoizedURLs.set(e, r), r;
        }
      };
    var no = yu;
    let wu = Mr,
      cs = class extends wu {
        constructor(e) {
          super(e), (this.type = "comment");
        }
      };
    var Ar = cs;
    cs.default = cs;
    let { isClean: oo, my: ao } = Ct,
      lo = Rr,
      uo = Ar,
      bu = Mr,
      co,
      Gs,
      js,
      ho;
    function fo(s) {
      return s.map((e) => (e.nodes && (e.nodes = fo(e.nodes)), delete e.source, e));
    }
    function po(s) {
      if (((s[oo] = !1), s.proxyOf.nodes)) for (let e of s.proxyOf.nodes) po(e);
    }
    let we = class mo extends bu {
      append(...e) {
        for (let t of e) {
          let r = this.normalize(t, this.last);
          for (let i of r) this.proxyOf.nodes.push(i);
        }
        return this.markDirty(), this;
      }
      cleanRaws(e) {
        if ((super.cleanRaws(e), this.nodes)) for (let t of this.nodes) t.cleanRaws(e);
      }
      each(e) {
        if (!this.proxyOf.nodes) return;
        let t = this.getIterator(),
          r,
          i;
        for (
          ;
          this.indexes[t] < this.proxyOf.nodes.length &&
          ((r = this.indexes[t]), (i = e(this.proxyOf.nodes[r], r)), i !== !1);

        )
          this.indexes[t] += 1;
        return delete this.indexes[t], i;
      }
      every(e) {
        return this.nodes.every(e);
      }
      getIterator() {
        this.lastEach || (this.lastEach = 0), this.indexes || (this.indexes = {}), (this.lastEach += 1);
        let e = this.lastEach;
        return (this.indexes[e] = 0), e;
      }
      getProxyProcessor() {
        return {
          get(e, t) {
            return t === "proxyOf"
              ? e
              : e[t]
              ? t === "each" || (typeof t == "string" && t.startsWith("walk"))
                ? (...r) => e[t](...r.map((i) => (typeof i == "function" ? (o, n) => i(o.toProxy(), n) : i)))
                : t === "every" || t === "some"
                ? (r) => e[t]((i, ...o) => r(i.toProxy(), ...o))
                : t === "root"
                ? () => e.root().toProxy()
                : t === "nodes"
                ? e.nodes.map((r) => r.toProxy())
                : t === "first" || t === "last"
                ? e[t].toProxy()
                : e[t]
              : e[t];
          },
          set(e, t, r) {
            return (
              e[t] === r || ((e[t] = r), (t === "name" || t === "params" || t === "selector") && e.markDirty()), !0
            );
          },
        };
      }
      index(e) {
        return typeof e == "number" ? e : (e.proxyOf && (e = e.proxyOf), this.proxyOf.nodes.indexOf(e));
      }
      insertAfter(e, t) {
        let r = this.index(e),
          i = this.normalize(t, this.proxyOf.nodes[r]).reverse();
        r = this.index(e);
        for (let n of i) this.proxyOf.nodes.splice(r + 1, 0, n);
        let o;
        for (let n in this.indexes) (o = this.indexes[n]), r < o && (this.indexes[n] = o + i.length);
        return this.markDirty(), this;
      }
      insertBefore(e, t) {
        let r = this.index(e),
          i = r === 0 ? "prepend" : !1,
          o = this.normalize(t, this.proxyOf.nodes[r], i).reverse();
        r = this.index(e);
        for (let a of o) this.proxyOf.nodes.splice(r, 0, a);
        let n;
        for (let a in this.indexes) (n = this.indexes[a]), r <= n && (this.indexes[a] = n + o.length);
        return this.markDirty(), this;
      }
      normalize(e, t) {
        if (typeof e == "string") e = fo(co(e).nodes);
        else if (typeof e == "undefined") e = [];
        else if (Array.isArray(e)) {
          e = e.slice(0);
          for (let i of e) i.parent && i.parent.removeChild(i, "ignore");
        } else if (e.type === "root" && this.type !== "document") {
          e = e.nodes.slice(0);
          for (let i of e) i.parent && i.parent.removeChild(i, "ignore");
        } else if (e.type) e = [e];
        else if (e.prop) {
          if (typeof e.value == "undefined") throw new Error("Value field is missed in node creation");
          typeof e.value != "string" && (e.value = String(e.value)), (e = [new lo(e)]);
        } else if (e.selector) e = [new Gs(e)];
        else if (e.name) e = [new js(e)];
        else if (e.text) e = [new uo(e)];
        else throw new Error("Unknown node type in node creation");
        return e.map(
          (i) => (
            i[ao] || mo.rebuild(i),
            (i = i.proxyOf),
            i.parent && i.parent.removeChild(i),
            i[oo] && po(i),
            typeof i.raws.before == "undefined" &&
              t &&
              typeof t.raws.before != "undefined" &&
              (i.raws.before = t.raws.before.replace(/\S/g, "")),
            (i.parent = this.proxyOf),
            i
          ),
        );
      }
      prepend(...e) {
        e = e.reverse();
        for (let t of e) {
          let r = this.normalize(t, this.first, "prepend").reverse();
          for (let i of r) this.proxyOf.nodes.unshift(i);
          for (let i in this.indexes) this.indexes[i] = this.indexes[i] + r.length;
        }
        return this.markDirty(), this;
      }
      push(e) {
        return (e.parent = this), this.proxyOf.nodes.push(e), this;
      }
      removeAll() {
        for (let e of this.proxyOf.nodes) e.parent = void 0;
        return (this.proxyOf.nodes = []), this.markDirty(), this;
      }
      removeChild(e) {
        (e = this.index(e)), (this.proxyOf.nodes[e].parent = void 0), this.proxyOf.nodes.splice(e, 1);
        let t;
        for (let r in this.indexes) (t = this.indexes[r]), t >= e && (this.indexes[r] = t - 1);
        return this.markDirty(), this;
      }
      replaceValues(e, t, r) {
        return (
          r || ((r = t), (t = {})),
          this.walkDecls((i) => {
            (t.props && !t.props.includes(i.prop)) ||
              (t.fast && !i.value.includes(t.fast)) ||
              (i.value = i.value.replace(e, r));
          }),
          this.markDirty(),
          this
        );
      }
      some(e) {
        return this.nodes.some(e);
      }
      walk(e) {
        return this.each((t, r) => {
          let i;
          try {
            i = e(t, r);
          } catch (o) {
            throw t.addToError(o);
          }
          return i !== !1 && t.walk && (i = t.walk(e)), i;
        });
      }
      walkAtRules(e, t) {
        return t
          ? e instanceof RegExp
            ? this.walk((r, i) => {
                if (r.type === "atrule" && e.test(r.name)) return t(r, i);
              })
            : this.walk((r, i) => {
                if (r.type === "atrule" && r.name === e) return t(r, i);
              })
          : ((t = e),
            this.walk((r, i) => {
              if (r.type === "atrule") return t(r, i);
            }));
      }
      walkComments(e) {
        return this.walk((t, r) => {
          if (t.type === "comment") return e(t, r);
        });
      }
      walkDecls(e, t) {
        return t
          ? e instanceof RegExp
            ? this.walk((r, i) => {
                if (r.type === "decl" && e.test(r.prop)) return t(r, i);
              })
            : this.walk((r, i) => {
                if (r.type === "decl" && r.prop === e) return t(r, i);
              })
          : ((t = e),
            this.walk((r, i) => {
              if (r.type === "decl") return t(r, i);
            }));
      }
      walkRules(e, t) {
        return t
          ? e instanceof RegExp
            ? this.walk((r, i) => {
                if (r.type === "rule" && e.test(r.selector)) return t(r, i);
              })
            : this.walk((r, i) => {
                if (r.type === "rule" && r.selector === e) return t(r, i);
              })
          : ((t = e),
            this.walk((r, i) => {
              if (r.type === "rule") return t(r, i);
            }));
      }
      get first() {
        if (this.proxyOf.nodes) return this.proxyOf.nodes[0];
      }
      get last() {
        if (this.proxyOf.nodes) return this.proxyOf.nodes[this.proxyOf.nodes.length - 1];
      }
    };
    we.registerParse = (s) => {
      co = s;
    };
    we.registerRule = (s) => {
      Gs = s;
    };
    we.registerAtRule = (s) => {
      js = s;
    };
    we.registerRoot = (s) => {
      ho = s;
    };
    var _e = we;
    we.default = we;
    we.rebuild = (s) => {
      s.type === "atrule"
        ? Object.setPrototypeOf(s, js.prototype)
        : s.type === "rule"
        ? Object.setPrototypeOf(s, Gs.prototype)
        : s.type === "decl"
        ? Object.setPrototypeOf(s, lo.prototype)
        : s.type === "comment"
        ? Object.setPrototypeOf(s, uo.prototype)
        : s.type === "root" && Object.setPrototypeOf(s, ho.prototype),
        (s[ao] = !0),
        s.nodes &&
          s.nodes.forEach((e) => {
            we.rebuild(e);
          });
    };
    let Su = _e,
      go,
      yo,
      dt = class extends Su {
        constructor(e) {
          super(R({ type: "document" }, e)), this.nodes || (this.nodes = []);
        }
        toResult(e = {}) {
          return new go(new yo(), this, e).stringify();
        }
      };
    dt.registerLazyResult = (s) => {
      go = s;
    };
    dt.registerProcessor = (s) => {
      yo = s;
    };
    var Ys = dt;
    dt.default = dt;
    let hs = class {
      constructor(e, t = {}) {
        if (((this.type = "warning"), (this.text = e), t.node && t.node.source)) {
          let r = t.node.rangeBy(t);
          (this.line = r.start.line),
            (this.column = r.start.column),
            (this.endLine = r.end.line),
            (this.endColumn = r.end.column);
        }
        for (let r in t) this[r] = t[r];
      }
      toString() {
        return this.node
          ? this.node.error(this.text, {
              index: this.index,
              plugin: this.plugin,
              word: this.word,
            }).message
          : this.plugin
          ? this.plugin + ": " + this.text
          : this.text;
      }
    };
    var wo = hs;
    hs.default = hs;
    let vu = wo,
      fs = class {
        constructor(e, t, r) {
          (this.processor = e),
            (this.messages = []),
            (this.root = t),
            (this.opts = r),
            (this.css = void 0),
            (this.map = void 0);
        }
        toString() {
          return this.css;
        }
        warn(e, t = {}) {
          t.plugin || (this.lastPlugin && this.lastPlugin.postcssPlugin && (t.plugin = this.lastPlugin.postcssPlugin));
          let r = new vu(e, t);
          return this.messages.push(r), r;
        }
        warnings() {
          return this.messages.filter((e) => e.type === "warning");
        }
        get content() {
          return this.css;
        }
      };
    var Hs = fs;
    fs.default = fs;
    const jr = 39,
      Hi = 34,
      kt = 92,
      Zi = 47,
      $t = 10,
      st = 32,
      Pt = 12,
      Lt = 9,
      Ft = 13,
      Cu = 91,
      Eu = 93,
      Iu = 40,
      xu = 41,
      Mu = 123,
      Ru = 125,
      Nu = 59,
      Au = 42,
      Ou = 58,
      Du = 64,
      Bt = /[\t\n\f\r "#'()/;[\\\]{}]/g,
      Ut = /[\t\n\f\r !"#'():;@[\\\]{}]|\/(?=\*)/g,
      Tu = /.[\r\n"'(/\\]/,
      Xi = /[\da-f]/i;
    var _u = function (e, t = {}) {
      let r = e.css.valueOf(),
        i = t.ignoreErrors,
        o,
        n,
        a,
        l,
        u,
        c,
        h,
        f,
        p,
        g,
        m = r.length,
        d = 0,
        y = [],
        S = [];
      function w() {
        return d;
      }
      function v(D) {
        throw e.error("Unclosed " + D, d);
      }
      function x() {
        return S.length === 0 && d >= m;
      }
      function N(D) {
        if (S.length) return S.pop();
        if (d >= m) return;
        let J = D ? D.ignoreUnclosed : !1;
        switch (((o = r.charCodeAt(d)), o)) {
          case $t:
          case st:
          case Lt:
          case Ft:
          case Pt: {
            n = d;
            do (n += 1), (o = r.charCodeAt(n));
            while (o === st || o === $t || o === Lt || o === Ft || o === Pt);
            (g = ["space", r.slice(d, n)]), (d = n - 1);
            break;
          }
          case Cu:
          case Eu:
          case Mu:
          case Ru:
          case Ou:
          case Nu:
          case xu: {
            let K = String.fromCharCode(o);
            g = [K, K, d];
            break;
          }
          case Iu: {
            if (
              ((f = y.length ? y.pop()[1] : ""),
              (p = r.charCodeAt(d + 1)),
              f === "url" && p !== jr && p !== Hi && p !== st && p !== $t && p !== Lt && p !== Pt && p !== Ft)
            ) {
              n = d;
              do {
                if (((c = !1), (n = r.indexOf(")", n + 1)), n === -1))
                  if (i || J) {
                    n = d;
                    break;
                  } else v("bracket");
                for (h = n; r.charCodeAt(h - 1) === kt; ) (h -= 1), (c = !c);
              } while (c);
              (g = ["brackets", r.slice(d, n + 1), d, n]), (d = n);
            } else
              (n = r.indexOf(")", d + 1)),
                (l = r.slice(d, n + 1)),
                n === -1 || Tu.test(l) ? (g = ["(", "(", d]) : ((g = ["brackets", l, d, n]), (d = n));
            break;
          }
          case jr:
          case Hi: {
            (a = o === jr ? "'" : '"'), (n = d);
            do {
              if (((c = !1), (n = r.indexOf(a, n + 1)), n === -1))
                if (i || J) {
                  n = d + 1;
                  break;
                } else v("string");
              for (h = n; r.charCodeAt(h - 1) === kt; ) (h -= 1), (c = !c);
            } while (c);
            (g = ["string", r.slice(d, n + 1), d, n]), (d = n);
            break;
          }
          case Du: {
            (Bt.lastIndex = d + 1),
              Bt.test(r),
              Bt.lastIndex === 0 ? (n = r.length - 1) : (n = Bt.lastIndex - 2),
              (g = ["at-word", r.slice(d, n + 1), d, n]),
              (d = n);
            break;
          }
          case kt: {
            for (n = d, u = !0; r.charCodeAt(n + 1) === kt; ) (n += 1), (u = !u);
            if (
              ((o = r.charCodeAt(n + 1)),
              u &&
                o !== Zi &&
                o !== st &&
                o !== $t &&
                o !== Lt &&
                o !== Ft &&
                o !== Pt &&
                ((n += 1), Xi.test(r.charAt(n))))
            ) {
              for (; Xi.test(r.charAt(n + 1)); ) n += 1;
              r.charCodeAt(n + 1) === st && (n += 1);
            }
            (g = ["word", r.slice(d, n + 1), d, n]), (d = n);
            break;
          }
          default: {
            o === Zi && r.charCodeAt(d + 1) === Au
              ? ((n = r.indexOf("*/", d + 2) + 1),
                n === 0 && (i || J ? (n = r.length) : v("comment")),
                (g = ["comment", r.slice(d, n + 1), d, n]),
                (d = n))
              : ((Ut.lastIndex = d + 1),
                Ut.test(r),
                Ut.lastIndex === 0 ? (n = r.length - 1) : (n = Ut.lastIndex - 2),
                (g = ["word", r.slice(d, n + 1), d, n]),
                y.push(g),
                (d = n));
            break;
          }
        }
        return d++, g;
      }
      function z(D) {
        S.push(D);
      }
      return { back: z, endOfFile: x, nextToken: N, position: w };
    };
    let bo = _e,
      fr = class extends bo {
        constructor(e) {
          super(e), (this.type = "atrule");
        }
        append(...e) {
          return this.proxyOf.nodes || (this.nodes = []), super.append(...e);
        }
        prepend(...e) {
          return this.proxyOf.nodes || (this.nodes = []), super.prepend(...e);
        }
      };
    var Zs = fr;
    fr.default = fr;
    bo.registerAtRule(fr);
    let So = _e,
      vo,
      Co,
      Ze = class extends So {
        constructor(e) {
          super(e), (this.type = "root"), this.nodes || (this.nodes = []);
        }
        normalize(e, t, r) {
          let i = super.normalize(e);
          if (t) {
            if (r === "prepend")
              this.nodes.length > 1 ? (t.raws.before = this.nodes[1].raws.before) : delete t.raws.before;
            else if (this.first !== t) for (let o of i) o.raws.before = t.raws.before;
          }
          return i;
        }
        removeChild(e, t) {
          let r = this.index(e);
          return (
            !t && r === 0 && this.nodes.length > 1 && (this.nodes[1].raws.before = this.nodes[r].raws.before),
            super.removeChild(e)
          );
        }
        toResult(e = {}) {
          return new vo(new Co(), this, e).stringify();
        }
      };
    Ze.registerLazyResult = (s) => {
      vo = s;
    };
    Ze.registerProcessor = (s) => {
      Co = s;
    };
    var Et = Ze;
    Ze.default = Ze;
    So.registerRoot(Ze);
    let pt = {
      comma(s) {
        return pt.split(s, [","], !0);
      },
      space(s) {
        let e = [
          " ",
          `
`,
          "	",
        ];
        return pt.split(s, e);
      },
      split(s, e, t) {
        let r = [],
          i = "",
          o = !1,
          n = 0,
          a = !1,
          l = "",
          u = !1;
        for (let c of s)
          u
            ? (u = !1)
            : c === "\\"
            ? (u = !0)
            : a
            ? c === l && (a = !1)
            : c === '"' || c === "'"
            ? ((a = !0), (l = c))
            : c === "("
            ? (n += 1)
            : c === ")"
            ? n > 0 && (n -= 1)
            : n === 0 && e.includes(c) && (o = !0),
            o ? (i !== "" && r.push(i.trim()), (i = ""), (o = !1)) : (i += c);
        return (t || i !== "") && r.push(i.trim()), r;
      },
    };
    var Eo = pt;
    pt.default = pt;
    let Io = _e,
      ku = Eo,
      dr = class extends Io {
        constructor(e) {
          super(e), (this.type = "rule"), this.nodes || (this.nodes = []);
        }
        get selectors() {
          return ku.comma(this.selector);
        }
        set selectors(e) {
          let t = this.selector ? this.selector.match(/,\s*/) : null,
            r = t ? t[0] : "," + this.raw("between", "beforeOpen");
          this.selector = e.join(r);
        }
      };
    var Xs = dr;
    dr.default = dr;
    Io.registerRule(dr);
    let $u = Rr,
      Pu = _u,
      Lu = Ar,
      Fu = Zs,
      Bu = Et,
      Ji = Xs;
    const Ki = { empty: !0, space: !0 };
    function Uu(s) {
      for (let e = s.length - 1; e >= 0; e--) {
        let t = s[e],
          r = t[3] || t[2];
        if (r) return r;
      }
    }
    let Wu = class {
      constructor(e) {
        (this.input = e),
          (this.root = new Bu()),
          (this.current = this.root),
          (this.spaces = ""),
          (this.semicolon = !1),
          this.createTokenizer(),
          (this.root.source = {
            input: e,
            start: { column: 1, line: 1, offset: 0 },
          });
      }
      atrule(e) {
        let t = new Fu();
        (t.name = e[1].slice(1)), t.name === "" && this.unnamedAtrule(t, e), this.init(t, e[2]);
        let r,
          i,
          o,
          n = !1,
          a = !1,
          l = [],
          u = [];
        for (; !this.tokenizer.endOfFile(); ) {
          if (
            ((e = this.tokenizer.nextToken()),
            (r = e[0]),
            r === "(" || r === "["
              ? u.push(r === "(" ? ")" : "]")
              : r === "{" && u.length > 0
              ? u.push("}")
              : r === u[u.length - 1] && u.pop(),
            u.length === 0)
          )
            if (r === ";") {
              (t.source.end = this.getPosition(e[2])), t.source.end.offset++, (this.semicolon = !0);
              break;
            } else if (r === "{") {
              a = !0;
              break;
            } else if (r === "}") {
              if (l.length > 0) {
                for (o = l.length - 1, i = l[o]; i && i[0] === "space"; ) i = l[--o];
                i && ((t.source.end = this.getPosition(i[3] || i[2])), t.source.end.offset++);
              }
              this.end(e);
              break;
            } else l.push(e);
          else l.push(e);
          if (this.tokenizer.endOfFile()) {
            n = !0;
            break;
          }
        }
        (t.raws.between = this.spacesAndCommentsFromEnd(l)),
          l.length
            ? ((t.raws.afterName = this.spacesAndCommentsFromStart(l)),
              this.raw(t, "params", l),
              n &&
                ((e = l[l.length - 1]),
                (t.source.end = this.getPosition(e[3] || e[2])),
                t.source.end.offset++,
                (this.spaces = t.raws.between),
                (t.raws.between = "")))
            : ((t.raws.afterName = ""), (t.params = "")),
          a && ((t.nodes = []), (this.current = t));
      }
      checkMissedSemicolon(e) {
        let t = this.colon(e);
        if (t === !1) return;
        let r = 0,
          i;
        for (let o = t - 1; o >= 0 && ((i = e[o]), !(i[0] !== "space" && ((r += 1), r === 2))); o--);
        throw this.input.error("Missed semicolon", i[0] === "word" ? i[3] + 1 : i[2]);
      }
      colon(e) {
        let t = 0,
          r,
          i,
          o;
        for (let [n, a] of e.entries()) {
          if (((r = a), (i = r[0]), i === "(" && (t += 1), i === ")" && (t -= 1), t === 0 && i === ":"))
            if (!o) this.doubleColon(r);
            else {
              if (o[0] === "word" && o[1] === "progid") continue;
              return n;
            }
          o = r;
        }
        return !1;
      }
      comment(e) {
        let t = new Lu();
        this.init(t, e[2]), (t.source.end = this.getPosition(e[3] || e[2])), t.source.end.offset++;
        let r = e[1].slice(2, -2);
        if (/^\s*$/.test(r)) (t.text = ""), (t.raws.left = r), (t.raws.right = "");
        else {
          let i = r.match(/^(\s*)([^]*\S)(\s*)$/);
          (t.text = i[2]), (t.raws.left = i[1]), (t.raws.right = i[3]);
        }
      }
      createTokenizer() {
        this.tokenizer = Pu(this.input);
      }
      decl(e, t) {
        let r = new $u();
        this.init(r, e[0][2]);
        let i = e[e.length - 1];
        for (
          i[0] === ";" && ((this.semicolon = !0), e.pop()),
            r.source.end = this.getPosition(i[3] || i[2] || Uu(e)),
            r.source.end.offset++;
          e[0][0] !== "word";

        )
          e.length === 1 && this.unknownWord(e), (r.raws.before += e.shift()[1]);
        for (r.source.start = this.getPosition(e[0][2]), r.prop = ""; e.length; ) {
          let u = e[0][0];
          if (u === ":" || u === "space" || u === "comment") break;
          r.prop += e.shift()[1];
        }
        r.raws.between = "";
        let o;
        for (; e.length; )
          if (((o = e.shift()), o[0] === ":")) {
            r.raws.between += o[1];
            break;
          } else o[0] === "word" && /\w/.test(o[1]) && this.unknownWord([o]), (r.raws.between += o[1]);
        (r.prop[0] === "_" || r.prop[0] === "*") && ((r.raws.before += r.prop[0]), (r.prop = r.prop.slice(1)));
        let n = [],
          a;
        for (; e.length && ((a = e[0][0]), !(a !== "space" && a !== "comment")); ) n.push(e.shift());
        this.precheckMissedSemicolon(e);
        for (let u = e.length - 1; u >= 0; u--) {
          if (((o = e[u]), o[1].toLowerCase() === "!important")) {
            r.important = !0;
            let c = this.stringFrom(e, u);
            (c = this.spacesFromEnd(e) + c), c !== " !important" && (r.raws.important = c);
            break;
          } else if (o[1].toLowerCase() === "important") {
            let c = e.slice(0),
              h = "";
            for (let f = u; f > 0; f--) {
              let p = c[f][0];
              if (h.trim().indexOf("!") === 0 && p !== "space") break;
              h = c.pop()[1] + h;
            }
            h.trim().indexOf("!") === 0 && ((r.important = !0), (r.raws.important = h), (e = c));
          }
          if (o[0] !== "space" && o[0] !== "comment") break;
        }
        e.some((u) => u[0] !== "space" && u[0] !== "comment") &&
          ((r.raws.between += n.map((u) => u[1]).join("")), (n = [])),
          this.raw(r, "value", n.concat(e), t),
          r.value.includes(":") && !t && this.checkMissedSemicolon(e);
      }
      doubleColon(e) {
        throw this.input.error("Double colon", { offset: e[2] }, { offset: e[2] + e[1].length });
      }
      emptyRule(e) {
        let t = new Ji();
        this.init(t, e[2]), (t.selector = ""), (t.raws.between = ""), (this.current = t);
      }
      end(e) {
        this.current.nodes && this.current.nodes.length && (this.current.raws.semicolon = this.semicolon),
          (this.semicolon = !1),
          (this.current.raws.after = (this.current.raws.after || "") + this.spaces),
          (this.spaces = ""),
          this.current.parent
            ? ((this.current.source.end = this.getPosition(e[2])),
              this.current.source.end.offset++,
              (this.current = this.current.parent))
            : this.unexpectedClose(e);
      }
      endFile() {
        this.current.parent && this.unclosedBlock(),
          this.current.nodes && this.current.nodes.length && (this.current.raws.semicolon = this.semicolon),
          (this.current.raws.after = (this.current.raws.after || "") + this.spaces),
          (this.root.source.end = this.getPosition(this.tokenizer.position()));
      }
      freeSemicolon(e) {
        if (((this.spaces += e[1]), this.current.nodes)) {
          let t = this.current.nodes[this.current.nodes.length - 1];
          t && t.type === "rule" && !t.raws.ownSemicolon && ((t.raws.ownSemicolon = this.spaces), (this.spaces = ""));
        }
      }
      getPosition(e) {
        let t = this.input.fromOffset(e);
        return { column: t.col, line: t.line, offset: e };
      }
      init(e, t) {
        this.current.push(e),
          (e.source = { input: this.input, start: this.getPosition(t) }),
          (e.raws.before = this.spaces),
          (this.spaces = ""),
          e.type !== "comment" && (this.semicolon = !1);
      }
      other(e) {
        let t = !1,
          r = null,
          i = !1,
          o = null,
          n = [],
          a = e[1].startsWith("--"),
          l = [],
          u = e;
        for (; u; ) {
          if (((r = u[0]), l.push(u), r === "(" || r === "[")) o || (o = u), n.push(r === "(" ? ")" : "]");
          else if (a && i && r === "{") o || (o = u), n.push("}");
          else if (n.length === 0)
            if (r === ";")
              if (i) {
                this.decl(l, a);
                return;
              } else break;
            else if (r === "{") {
              this.rule(l);
              return;
            } else if (r === "}") {
              this.tokenizer.back(l.pop()), (t = !0);
              break;
            } else r === ":" && (i = !0);
          else r === n[n.length - 1] && (n.pop(), n.length === 0 && (o = null));
          u = this.tokenizer.nextToken();
        }
        if ((this.tokenizer.endOfFile() && (t = !0), n.length > 0 && this.unclosedBracket(o), t && i)) {
          if (!a)
            for (; l.length && ((u = l[l.length - 1][0]), !(u !== "space" && u !== "comment")); )
              this.tokenizer.back(l.pop());
          this.decl(l, a);
        } else this.unknownWord(l);
      }
      parse() {
        let e;
        for (; !this.tokenizer.endOfFile(); )
          switch (((e = this.tokenizer.nextToken()), e[0])) {
            case "space":
              this.spaces += e[1];
              break;
            case ";":
              this.freeSemicolon(e);
              break;
            case "}":
              this.end(e);
              break;
            case "comment":
              this.comment(e);
              break;
            case "at-word":
              this.atrule(e);
              break;
            case "{":
              this.emptyRule(e);
              break;
            default:
              this.other(e);
              break;
          }
        this.endFile();
      }
      precheckMissedSemicolon() {}
      raw(e, t, r, i) {
        let o,
          n,
          a = r.length,
          l = "",
          u = !0,
          c,
          h;
        for (let f = 0; f < a; f += 1)
          (o = r[f]),
            (n = o[0]),
            n === "space" && f === a - 1 && !i
              ? (u = !1)
              : n === "comment"
              ? ((h = r[f - 1] ? r[f - 1][0] : "empty"),
                (c = r[f + 1] ? r[f + 1][0] : "empty"),
                !Ki[h] && !Ki[c] ? (l.slice(-1) === "," ? (u = !1) : (l += o[1])) : (u = !1))
              : (l += o[1]);
        if (!u) {
          let f = r.reduce((p, g) => p + g[1], "");
          e.raws[t] = { raw: f, value: l };
        }
        e[t] = l;
      }
      rule(e) {
        e.pop();
        let t = new Ji();
        this.init(t, e[0][2]),
          (t.raws.between = this.spacesAndCommentsFromEnd(e)),
          this.raw(t, "selector", e),
          (this.current = t);
      }
      spacesAndCommentsFromEnd(e) {
        let t,
          r = "";
        for (; e.length && ((t = e[e.length - 1][0]), !(t !== "space" && t !== "comment")); ) r = e.pop()[1] + r;
        return r;
      }
      spacesAndCommentsFromStart(e) {
        let t,
          r = "";
        for (; e.length && ((t = e[0][0]), !(t !== "space" && t !== "comment")); ) r += e.shift()[1];
        return r;
      }
      spacesFromEnd(e) {
        let t,
          r = "";
        for (; e.length && ((t = e[e.length - 1][0]), t === "space"); ) r = e.pop()[1] + r;
        return r;
      }
      stringFrom(e, t) {
        let r = "";
        for (let i = t; i < e.length; i++) r += e[i][1];
        return e.splice(t, e.length - t), r;
      }
      unclosedBlock() {
        let e = this.current.source.start;
        throw this.input.error("Unclosed block", e.line, e.column);
      }
      unclosedBracket(e) {
        throw this.input.error("Unclosed bracket", { offset: e[2] }, { offset: e[2] + 1 });
      }
      unexpectedClose(e) {
        throw this.input.error("Unexpected }", { offset: e[2] }, { offset: e[2] + 1 });
      }
      unknownWord(e) {
        throw this.input.error("Unknown word", { offset: e[0][2] }, { offset: e[0][2] + e[0][1].length });
      }
      unnamedAtrule(e, t) {
        throw this.input.error("At-rule without name", { offset: t[2] }, { offset: t[2] + t[1].length });
      }
    };
    var zu = Wu;
    let Vu = _e,
      Gu = zu,
      ju = Nr;
    function pr(s, e) {
      let t = new ju(s, e),
        r = new Gu(t);
      try {
        r.parse();
      } catch (i) {
        throw i;
      }
      return r.root;
    }
    var Js = pr;
    pr.default = pr;
    Vu.registerParse(pr);
    let { isClean: pe, my: Yu } = Ct,
      Hu = no,
      Zu = xr,
      Xu = _e,
      Ju = Ys;
    let Qi = Hs,
      Ku = Js,
      Qu = Et;
    const qu = {
        atrule: "AtRule",
        comment: "Comment",
        decl: "Declaration",
        document: "Document",
        root: "Root",
        rule: "Rule",
      },
      ec = {
        AtRule: !0,
        AtRuleExit: !0,
        Comment: !0,
        CommentExit: !0,
        Declaration: !0,
        DeclarationExit: !0,
        Document: !0,
        DocumentExit: !0,
        Once: !0,
        OnceExit: !0,
        postcssPlugin: !0,
        prepare: !0,
        Root: !0,
        RootExit: !0,
        Rule: !0,
        RuleExit: !0,
      },
      tc = { Once: !0, postcssPlugin: !0, prepare: !0 },
      Xe = 0;
    function it(s) {
      return typeof s == "object" && typeof s.then == "function";
    }
    function xo(s) {
      let e = !1,
        t = qu[s.type];
      return (
        s.type === "decl" ? (e = s.prop.toLowerCase()) : s.type === "atrule" && (e = s.name.toLowerCase()),
        e && s.append
          ? [t, t + "-" + e, Xe, t + "Exit", t + "Exit-" + e]
          : e
          ? [t, t + "-" + e, t + "Exit", t + "Exit-" + e]
          : s.append
          ? [t, Xe, t + "Exit"]
          : [t, t + "Exit"]
      );
    }
    function qi(s) {
      let e;
      return (
        s.type === "document"
          ? (e = ["Document", Xe, "DocumentExit"])
          : s.type === "root"
          ? (e = ["Root", Xe, "RootExit"])
          : (e = xo(s)),
        {
          eventIndex: 0,
          events: e,
          iterator: 0,
          node: s,
          visitorIndex: 0,
          visitors: [],
        }
      );
    }
    function ds(s) {
      return (s[pe] = !1), s.nodes && s.nodes.forEach((e) => ds(e)), s;
    }
    let ps = {},
      Je = class Mo {
        constructor(e, t, r) {
          (this.stringified = !1), (this.processed = !1);
          let i;
          if (typeof t == "object" && t !== null && (t.type === "root" || t.type === "document")) i = ds(t);
          else if (t instanceof Mo || t instanceof Qi)
            (i = ds(t.root)),
              t.map &&
                (typeof r.map == "undefined" && (r.map = {}),
                r.map.inline || (r.map.inline = !1),
                (r.map.prev = t.map));
          else {
            let o = Ku;
            r.syntax && (o = r.syntax.parse), r.parser && (o = r.parser), o.parse && (o = o.parse);
            try {
              i = o(t, r);
            } catch (n) {
              (this.processed = !0), (this.error = n);
            }
            i && !i[Yu] && Xu.rebuild(i);
          }
          (this.result = new Qi(e, i, r)),
            (this.helpers = Q(R({}, ps), { postcss: ps, result: this.result })),
            (this.plugins = this.processor.plugins.map((o) =>
              typeof o == "object" && o.prepare ? R(R({}, o), o.prepare(this.result)) : o,
            ));
        }
        async() {
          return this.error
            ? Promise.reject(this.error)
            : this.processed
            ? Promise.resolve(this.result)
            : (this.processing || (this.processing = this.runAsync()), this.processing);
        }
        catch(e) {
          return this.async().catch(e);
        }
        finally(e) {
          return this.async().then(e, e);
        }
        getAsyncError() {
          throw new Error("Use process(css).then(cb) to work with async plugins");
        }
        handleError(e, t) {
          let r = this.result.lastPlugin;
          try {
            t && t.addToError(e),
              (this.error = e),
              e.name === "CssSyntaxError" && !e.plugin
                ? ((e.plugin = r.postcssPlugin), e.setMessage())
                : r.postcssVersion;
          } catch (i) {
            console && console.error && console.error(i);
          }
          return e;
        }
        prepareVisitors() {
          this.listeners = {};
          let e = (t, r, i) => {
            this.listeners[r] || (this.listeners[r] = []), this.listeners[r].push([t, i]);
          };
          for (let t of this.plugins)
            if (typeof t == "object")
              for (let r in t) {
                if (!ec[r] && /^[A-Z]/.test(r))
                  throw new Error(
                    `Unknown event ${r} in ${t.postcssPlugin}. Try to update PostCSS (${this.processor.version} now).`,
                  );
                if (!tc[r])
                  if (typeof t[r] == "object")
                    for (let i in t[r]) i === "*" ? e(t, r, t[r][i]) : e(t, r + "-" + i.toLowerCase(), t[r][i]);
                  else typeof t[r] == "function" && e(t, r, t[r]);
              }
          this.hasListener = Object.keys(this.listeners).length > 0;
        }
        async runAsync() {
          this.plugin = 0;
          for (let e = 0; e < this.plugins.length; e++) {
            let t = this.plugins[e],
              r = this.runOnRoot(t);
            if (it(r))
              try {
                await r;
              } catch (i) {
                throw this.handleError(i);
              }
          }
          if ((this.prepareVisitors(), this.hasListener)) {
            let e = this.result.root;
            for (; !e[pe]; ) {
              e[pe] = !0;
              let t = [qi(e)];
              for (; t.length > 0; ) {
                let r = this.visitTick(t);
                if (it(r))
                  try {
                    await r;
                  } catch (i) {
                    let o = t[t.length - 1].node;
                    throw this.handleError(i, o);
                  }
              }
            }
            if (this.listeners.OnceExit)
              for (let [t, r] of this.listeners.OnceExit) {
                this.result.lastPlugin = t;
                try {
                  if (e.type === "document") {
                    let i = e.nodes.map((o) => r(o, this.helpers));
                    await Promise.all(i);
                  } else await r(e, this.helpers);
                } catch (i) {
                  throw this.handleError(i);
                }
              }
          }
          return (this.processed = !0), this.stringify();
        }
        runOnRoot(e) {
          this.result.lastPlugin = e;
          try {
            if (typeof e == "object" && e.Once) {
              if (this.result.root.type === "document") {
                let t = this.result.root.nodes.map((r) => e.Once(r, this.helpers));
                return it(t[0]) ? Promise.all(t) : t;
              }
              return e.Once(this.result.root, this.helpers);
            } else if (typeof e == "function") return e(this.result.root, this.result);
          } catch (t) {
            throw this.handleError(t);
          }
        }
        stringify() {
          if (this.error) throw this.error;
          if (this.stringified) return this.result;
          (this.stringified = !0), this.sync();
          let e = this.result.opts,
            t = Zu;
          e.syntax && (t = e.syntax.stringify), e.stringifier && (t = e.stringifier), t.stringify && (t = t.stringify);
          let i = new Hu(t, this.result.root, this.result.opts).generate();
          return (this.result.css = i[0]), (this.result.map = i[1]), this.result;
        }
        sync() {
          if (this.error) throw this.error;
          if (this.processed) return this.result;
          if (((this.processed = !0), this.processing)) throw this.getAsyncError();
          for (let e of this.plugins) {
            let t = this.runOnRoot(e);
            if (it(t)) throw this.getAsyncError();
          }
          if ((this.prepareVisitors(), this.hasListener)) {
            let e = this.result.root;
            for (; !e[pe]; ) (e[pe] = !0), this.walkSync(e);
            if (this.listeners.OnceExit)
              if (e.type === "document") for (let t of e.nodes) this.visitSync(this.listeners.OnceExit, t);
              else this.visitSync(this.listeners.OnceExit, e);
          }
          return this.result;
        }
        then(e, t) {
          return this.async().then(e, t);
        }
        toString() {
          return this.css;
        }
        visitSync(e, t) {
          for (let [r, i] of e) {
            this.result.lastPlugin = r;
            let o;
            try {
              o = i(t, this.helpers);
            } catch (n) {
              throw this.handleError(n, t.proxyOf);
            }
            if (t.type !== "root" && t.type !== "document" && !t.parent) return !0;
            if (it(o)) throw this.getAsyncError();
          }
        }
        visitTick(e) {
          let t = e[e.length - 1],
            { node: r, visitors: i } = t;
          if (r.type !== "root" && r.type !== "document" && !r.parent) {
            e.pop();
            return;
          }
          if (i.length > 0 && t.visitorIndex < i.length) {
            let [n, a] = i[t.visitorIndex];
            (t.visitorIndex += 1),
              t.visitorIndex === i.length && ((t.visitors = []), (t.visitorIndex = 0)),
              (this.result.lastPlugin = n);
            try {
              return a(r.toProxy(), this.helpers);
            } catch (l) {
              throw this.handleError(l, r);
            }
          }
          if (t.iterator !== 0) {
            let n = t.iterator,
              a;
            for (; (a = r.nodes[r.indexes[n]]); )
              if (((r.indexes[n] += 1), !a[pe])) {
                (a[pe] = !0), e.push(qi(a));
                return;
              }
            (t.iterator = 0), delete r.indexes[n];
          }
          let o = t.events;
          for (; t.eventIndex < o.length; ) {
            let n = o[t.eventIndex];
            if (((t.eventIndex += 1), n === Xe)) {
              r.nodes && r.nodes.length && ((r[pe] = !0), (t.iterator = r.getIterator()));
              return;
            } else if (this.listeners[n]) {
              t.visitors = this.listeners[n];
              return;
            }
          }
          e.pop();
        }
        walkSync(e) {
          e[pe] = !0;
          let t = xo(e);
          for (let r of t)
            if (r === Xe)
              e.nodes &&
                e.each((i) => {
                  i[pe] || this.walkSync(i);
                });
            else {
              let i = this.listeners[r];
              if (i && this.visitSync(i, e.toProxy())) return;
            }
        }
        warnings() {
          return this.sync().warnings();
        }
        get content() {
          return this.stringify().content;
        }
        get css() {
          return this.stringify().css;
        }
        get map() {
          return this.stringify().map;
        }
        get messages() {
          return this.sync().messages;
        }
        get opts() {
          return this.result.opts;
        }
        get processor() {
          return this.result.processor;
        }
        get root() {
          return this.sync().root;
        }
        get [Symbol.toStringTag]() {
          return "LazyResult";
        }
      };
    Je.registerPostcss = (s) => {
      ps = s;
    };
    var Ro = Je;
    Je.default = Je;
    Qu.registerLazyResult(Je);
    Ju.registerLazyResult(Je);
    let rc = no,
      sc = xr;
    let ic = Js;
    const nc = Hs;
    let ms = class {
      constructor(e, t, r) {
        (t = t.toString()),
          (this.stringified = !1),
          (this._processor = e),
          (this._css = t),
          (this._opts = r),
          (this._map = void 0);
        let i,
          o = sc;
        (this.result = new nc(this._processor, i, this._opts)), (this.result.css = t);
        let n = this;
        Object.defineProperty(this.result, "root", {
          get() {
            return n.root;
          },
        });
        let a = new rc(o, i, this._opts, t);
        if (a.isMap()) {
          let [l, u] = a.generate();
          l && (this.result.css = l), u && (this.result.map = u);
        } else a.clearAnnotation(), (this.result.css = a.css);
      }
      async() {
        return this.error ? Promise.reject(this.error) : Promise.resolve(this.result);
      }
      catch(e) {
        return this.async().catch(e);
      }
      finally(e) {
        return this.async().then(e, e);
      }
      sync() {
        if (this.error) throw this.error;
        return this.result;
      }
      then(e, t) {
        return this.async().then(e, t);
      }
      toString() {
        return this._css;
      }
      warnings() {
        return [];
      }
      get content() {
        return this.result.css;
      }
      get css() {
        return this.result.css;
      }
      get map() {
        return this.result.map;
      }
      get messages() {
        return [];
      }
      get opts() {
        return this.result.opts;
      }
      get processor() {
        return this.result.processor;
      }
      get root() {
        if (this._root) return this._root;
        let e,
          t = ic;
        try {
          e = t(this._css, this._opts);
        } catch (r) {
          this.error = r;
        }
        if (this.error) throw this.error;
        return (this._root = e), e;
      }
      get [Symbol.toStringTag]() {
        return "NoWorkResult";
      }
    };
    var oc = ms;
    ms.default = ms;
    let ac = oc,
      lc = Ro,
      uc = Ys,
      cc = Et,
      mt = class {
        constructor(e = []) {
          (this.version = "8.4.38"), (this.plugins = this.normalize(e));
        }
        normalize(e) {
          let t = [];
          for (let r of e)
            if (
              (r.postcss === !0 ? (r = r()) : r.postcss && (r = r.postcss),
              typeof r == "object" && Array.isArray(r.plugins))
            )
              t = t.concat(r.plugins);
            else if (typeof r == "object" && r.postcssPlugin) t.push(r);
            else if (typeof r == "function") t.push(r);
            else if (!(typeof r == "object" && (r.parse || r.stringify)))
              throw new Error(r + " is not a PostCSS plugin");
          return t;
        }
        process(e, t = {}) {
          return !this.plugins.length && !t.parser && !t.stringifier && !t.syntax
            ? new ac(this, e, t)
            : new lc(this, e, t);
        }
        use(e) {
          return (this.plugins = this.plugins.concat(this.normalize([e]))), this;
        }
      };
    var hc = mt;
    mt.default = mt;
    cc.registerProcessor(mt);
    uc.registerProcessor(mt);
    let fc = Rr,
      dc = eo,
      pc = Ar,
      mc = Zs,
      gc = Nr,
      yc = Et,
      wc = Xs;
    function gt(s, e) {
      if (Array.isArray(s)) return s.map((n) => gt(n));
      let i = s,
        { inputs: t } = i,
        r = Le(i, ["inputs"]);
      if (t) {
        e = [];
        for (let n of t) {
          let a = Q(R({}, n), { __proto__: gc.prototype });
          a.map && (a.map = Q(R({}, a.map), { __proto__: dc.prototype })), e.push(a);
        }
      }
      if ((r.nodes && (r.nodes = s.nodes.map((n) => gt(n, e))), r.source)) {
        let o = r.source,
          { inputId: n } = o,
          a = Le(o, ["inputId"]);
        (r.source = a), n != null && (r.source.input = e[n]);
      }
      if (r.type === "root") return new yc(r);
      if (r.type === "decl") return new fc(r);
      if (r.type === "rule") return new wc(r);
      if (r.type === "comment") return new pc(r);
      if (r.type === "atrule") return new mc(r);
      throw new Error("Unknown node type: " + s.type);
    }
    var bc = gt;
    gt.default = gt;
    let Sc = Vs,
      No = Rr,
      vc = Ro,
      Cc = _e,
      Ks = hc,
      Ec = xr,
      Ic = bc,
      Ao = Ys,
      xc = wo,
      Oo = Ar,
      Do = Zs,
      Mc = Hs,
      Rc = Nr,
      Nc = Js,
      Ac = Eo,
      To = Xs,
      _o = Et,
      Oc = Mr;
    function L(...s) {
      return s.length === 1 && Array.isArray(s[0]) && (s = s[0]), new Ks(s);
    }
    L.plugin = function (e, t) {
      let r = !1;
      function i(...n) {
        console &&
          console.warn &&
          !r &&
          ((r = !0),
          console.warn(
            e +
              `: postcss.plugin was deprecated. Migration guide:
https://evilmartians.com/chronicles/postcss-8-plugin-migration`,
          ),
          process.env.LANG &&
            process.env.LANG.startsWith("cn") &&
            console.warn(
              e +
                `: \u91CC\u9762 postcss.plugin \u88AB\u5F03\u7528. \u8FC1\u79FB\u6307\u5357:
https://www.w3ctech.com/topic/2226`,
            ));
        let a = t(...n);
        return (a.postcssPlugin = e), (a.postcssVersion = new Ks().version), a;
      }
      let o;
      return (
        Object.defineProperty(i, "postcss", {
          get() {
            return o || (o = i()), o;
          },
        }),
        (i.process = function (n, a, l) {
          return L([i(l)]).process(n, a);
        }),
        i
      );
    };
    L.stringify = Ec;
    L.parse = Nc;
    L.fromJSON = Ic;
    L.list = Ac;
    L.comment = (s) => new Oo(s);
    L.atRule = (s) => new Do(s);
    L.decl = (s) => new No(s);
    L.rule = (s) => new To(s);
    L.root = (s) => new _o(s);
    L.document = (s) => new Ao(s);
    L.CssSyntaxError = Sc;
    L.Declaration = No;
    L.Container = Cc;
    L.Processor = Ks;
    L.Document = Ao;
    L.Comment = Oo;
    L.Warning = xc;
    L.AtRule = Do;
    L.Result = Mc;
    L.Input = Rc;
    L.Rule = To;
    L.Root = _o;
    L.Node = Oc;
    vc.registerPostcss(L);
    var Dc = L;
    L.default = L;
    const j = Vl(Dc);
    j.stringify;
    j.fromJSON;
    j.plugin;
    j.parse;
    j.list;
    j.document;
    j.comment;
    j.atRule;
    j.rule;
    j.decl;
    j.root;
    j.CssSyntaxError;
    j.Declaration;
    j.Container;
    j.Processor;
    j.Document;
    j.Comment;
    j.Warning;
    j.AtRule;
    j.Result;
    j.Input;
    j.Rule;
    j.Root;
    j.Node;
    const en = {
      script: "noscript",
      altglyph: "altGlyph",
      altglyphdef: "altGlyphDef",
      altglyphitem: "altGlyphItem",
      animatecolor: "animateColor",
      animatemotion: "animateMotion",
      animatetransform: "animateTransform",
      clippath: "clipPath",
      feblend: "feBlend",
      fecolormatrix: "feColorMatrix",
      fecomponenttransfer: "feComponentTransfer",
      fecomposite: "feComposite",
      feconvolvematrix: "feConvolveMatrix",
      fediffuselighting: "feDiffuseLighting",
      fedisplacementmap: "feDisplacementMap",
      fedistantlight: "feDistantLight",
      fedropshadow: "feDropShadow",
      feflood: "feFlood",
      fefunca: "feFuncA",
      fefuncb: "feFuncB",
      fefuncg: "feFuncG",
      fefuncr: "feFuncR",
      fegaussianblur: "feGaussianBlur",
      feimage: "feImage",
      femerge: "feMerge",
      femergenode: "feMergeNode",
      femorphology: "feMorphology",
      feoffset: "feOffset",
      fepointlight: "fePointLight",
      fespecularlighting: "feSpecularLighting",
      fespotlight: "feSpotLight",
      fetile: "feTile",
      feturbulence: "feTurbulence",
      foreignobject: "foreignObject",
      glyphref: "glyphRef",
      lineargradient: "linearGradient",
      radialgradient: "radialGradient",
    };
    function Tc(s) {
      let e = en[s.tagName] ? en[s.tagName] : s.tagName;
      return e === "link" && s.attributes._cssText && (e = "style"), e;
    }
    function tn(s, e) {
      const t = e == null ? void 0 : e.stylesWithHoverClass.get(s);
      if (t) return t;
      const i = j([Wl, zl]).process(s).css;
      return e == null || e.stylesWithHoverClass.set(s, i), i;
    }
    function rn() {
      return { stylesWithHoverClass: new Map() };
    }
    function _c(s, e) {
      var t;
      const { doc: r, hackCss: i, cache: o } = e;
      switch (s.type) {
        case M.Document:
          return r.implementation.createDocument(null, "", null);
        case M.DocumentType:
          return r.implementation.createDocumentType(s.name || "html", s.publicId, s.systemId);
        case M.Element: {
          const n = Tc(s);
          let a;
          s.isSVG
            ? (a = r.createElementNS("http://www.w3.org/2000/svg", n))
            : (s.isCustom &&
                (t = r.defaultView) != null &&
                t.customElements &&
                !r.defaultView.customElements.get(s.tagName) &&
                r.defaultView.customElements.define(s.tagName, class extends r.defaultView.HTMLElement {}),
              (a = r.createElement(n)));
          const l = {};
          for (const u in s.attributes) {
            if (!Object.prototype.hasOwnProperty.call(s.attributes, u)) continue;
            let c = s.attributes[u];
            if ((n === "option" && u === "selected" && c === !1) || c === null) continue;
            if ((c === !0 && (c = ""), u.startsWith("rr_"))) {
              l[u] = c;
              continue;
            }
            const h = n === "textarea" && u === "value",
              f = n === "style" && u === "_cssText";
            if ((f && i && typeof c == "string" && (c = tn(c, o)), (h || f) && typeof c == "string")) {
              a.appendChild(r.createTextNode(c)), (s.childNodes = []);
              continue;
            }
            try {
              if (s.isSVG && u === "xlink:href") a.setAttributeNS("http://www.w3.org/1999/xlink", u, c.toString());
              else if (u === "onload" || u === "onclick" || u.substring(0, 7) === "onmouse")
                a.setAttribute("_" + u, c.toString());
              else if (n === "meta" && s.attributes["http-equiv"] === "Content-Security-Policy" && u === "content") {
                a.setAttribute("csp-content", c.toString());
                continue;
              } else
                (n === "link" &&
                  (s.attributes.rel === "preload" || s.attributes.rel === "modulepreload") &&
                  s.attributes.as === "script") ||
                  (n === "link" &&
                    s.attributes.rel === "prefetch" &&
                    typeof s.attributes.href == "string" &&
                    s.attributes.href.endsWith(".js")) ||
                  (n === "img" && s.attributes.srcset && s.attributes.rr_dataURL
                    ? a.setAttribute("rrweb-original-srcset", s.attributes.srcset)
                    : a.setAttribute(u, c.toString()));
            } catch (p) {}
          }
          for (const u in l) {
            const c = l[u];
            if (n === "canvas" && u === "rr_dataURL") {
              const h = r.createElement("img");
              (h.onload = () => {
                const f = a.getContext("2d");
                f && f.drawImage(h, 0, 0, h.width, h.height);
              }),
                (h.src = c.toString()),
                a.RRNodeType && (a.rr_dataURL = c.toString());
            } else if (n === "img" && u === "rr_dataURL") {
              const h = a;
              h.currentSrc.startsWith("data:") ||
                (h.setAttribute("rrweb-original-src", s.attributes.src), (h.src = c.toString()));
            }
            if (u === "rr_width") a.style.width = c.toString();
            else if (u === "rr_height") a.style.height = c.toString();
            else if (u === "rr_mediaCurrentTime" && typeof c == "number") a.currentTime = c;
            else if (u === "rr_mediaState")
              switch (c) {
                case "played":
                  a.play().catch((h) => console.warn("media playback error", h));
                  break;
                case "paused":
                  a.pause();
                  break;
              }
            else
              u === "rr_mediaPlaybackRate" && typeof c == "number"
                ? (a.playbackRate = c)
                : u === "rr_mediaMuted" && typeof c == "boolean"
                ? (a.muted = c)
                : u === "rr_mediaLoop" && typeof c == "boolean"
                ? (a.loop = c)
                : u === "rr_mediaVolume" && typeof c == "number"
                ? (a.volume = c)
                : u === "rr_open_mode" && a.setAttribute("rr_open_mode", c);
          }
          if (s.isShadowHost)
            if (!a.shadowRoot) a.attachShadow({ mode: "open" });
            else for (; a.shadowRoot.firstChild; ) a.shadowRoot.removeChild(a.shadowRoot.firstChild);
          return a;
        }
        case M.Text:
          return r.createTextNode(s.isStyle && i ? tn(s.textContent, o) : s.textContent);
        case M.CDATA:
          return r.createCDATASection(s.textContent);
        case M.Comment:
          return r.createComment(s.textContent);
        default:
          return null;
      }
    }
    function ct(s, e) {
      const { doc: t, mirror: r, skipChild: i = !1, hackCss: o = !0, afterAppend: n, cache: a } = e;
      if (r.has(s.id)) {
        const u = r.getNode(s.id),
          c = r.getMeta(u);
        if (wl(c, s)) return r.getNode(s.id);
      }
      let l = _c(s, { doc: t, hackCss: o, cache: a });
      if (!l) return null;
      if (
        (s.rootId && r.getNode(s.rootId) !== t && r.replace(s.rootId, t),
        s.type === M.Document &&
          (t.close(),
          t.open(),
          s.compatMode === "BackCompat" &&
            s.childNodes &&
            s.childNodes[0].type !== M.DocumentType &&
            (s.childNodes[0].type === M.Element &&
            "xmlns" in s.childNodes[0].attributes &&
            s.childNodes[0].attributes.xmlns === "http://www.w3.org/1999/xhtml"
              ? t.write('<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "">')
              : t.write('<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.0 Transitional//EN" "">')),
          (l = t)),
        r.add(l, s),
        (s.type === M.Document || s.type === M.Element) && !i)
      )
        for (const u of s.childNodes) {
          const c = ct(u, {
            doc: t,
            mirror: r,
            skipChild: !1,
            hackCss: o,
            afterAppend: n,
            cache: a,
          });
          if (!c) {
            console.warn("Failed to rebuild", u);
            continue;
          }
          if (u.isShadow && Ls(l) && l.shadowRoot) l.shadowRoot.appendChild(c);
          else if (s.type === M.Document && u.type == M.Element) {
            const h = c;
            let f = null;
            h.childNodes.forEach((p) => {
              p.nodeName === "BODY" && (f = p);
            }),
              f ? (h.removeChild(f), l.appendChild(c), h.appendChild(f)) : l.appendChild(c);
          } else l.appendChild(c);
          n && n(c, u.id);
        }
      return l;
    }
    function kc(s, e) {
      function t(r) {
        e(r);
      }
      for (const r of s.getIds()) s.has(r) && t(s.getNode(r));
    }
    function $c(s, e) {
      const t = e.getMeta(s);
      if ((t == null ? void 0 : t.type) !== M.Element) return;
      const r = s;
      for (const i in t.attributes) {
        if (!(Object.prototype.hasOwnProperty.call(t.attributes, i) && i.startsWith("rr_"))) continue;
        const o = t.attributes[i];
        i === "rr_scrollLeft" && (r.scrollLeft = o), i === "rr_scrollTop" && (r.scrollTop = o);
      }
    }
    function Pc(s, e) {
      const { doc: t, onVisit: r, hackCss: i = !0, afterAppend: o, cache: n, mirror: a = new Fs() } = e,
        l = ct(s, {
          doc: t,
          mirror: a,
          skipChild: !1,
          hackCss: i,
          afterAppend: o,
          cache: n,
        });
      return (
        kc(a, (u) => {
          r && r(u), $c(u, a);
        }),
        l
      );
    }
    var Lc = Object.defineProperty,
      Fc = (s, e, t) =>
        e in s
          ? Lc(s, e, {
              enumerable: !0,
              configurable: !0,
              writable: !0,
              value: t,
            })
          : (s[e] = t),
      C = (s, e, t) => Fc(s, typeof e != "symbol" ? e + "" : e, t),
      Bc = Object.defineProperty,
      Uc = (s, e, t) =>
        e in s
          ? Bc(s, e, {
              enumerable: !0,
              configurable: !0,
              writable: !0,
              value: t,
            })
          : (s[e] = t),
      sn = (s, e, t) => Uc(s, typeof e != "symbol" ? e + "" : e, t),
      O = ((s) => (
        (s[(s.Document = 0)] = "Document"),
        (s[(s.DocumentType = 1)] = "DocumentType"),
        (s[(s.Element = 2)] = "Element"),
        (s[(s.Text = 3)] = "Text"),
        (s[(s.CDATA = 4)] = "CDATA"),
        (s[(s.Comment = 5)] = "Comment"),
        s
      ))(O || {});
    let Wc = class {
      constructor() {
        sn(this, "idNodeMap", new Map()), sn(this, "nodeMetaMap", new WeakMap());
      }
      getId(e) {
        var t;
        if (!e) return -1;
        const r = (t = this.getMeta(e)) == null ? void 0 : t.id;
        return r != null ? r : -1;
      }
      getNode(e) {
        return this.idNodeMap.get(e) || null;
      }
      getIds() {
        return Array.from(this.idNodeMap.keys());
      }
      getMeta(e) {
        return this.nodeMetaMap.get(e) || null;
      }
      removeNodeFromMap(e) {
        const t = this.getId(e);
        this.idNodeMap.delete(t), e.childNodes && e.childNodes.forEach((r) => this.removeNodeFromMap(r));
      }
      has(e) {
        return this.idNodeMap.has(e);
      }
      hasNode(e) {
        return this.nodeMetaMap.has(e);
      }
      add(e, t) {
        const r = t.id;
        this.idNodeMap.set(r, e), this.nodeMetaMap.set(e, t);
      }
      replace(e, t) {
        const r = this.getNode(e);
        if (r) {
          const i = this.nodeMetaMap.get(r);
          i && this.nodeMetaMap.set(t, i);
        }
        this.idNodeMap.set(e, t);
      }
      reset() {
        (this.idNodeMap = new Map()), (this.nodeMetaMap = new WeakMap());
      }
    };
    function zc() {
      return new Wc();
    }
    function Vc(s) {
      return s && s.__esModule && Object.prototype.hasOwnProperty.call(s, "default") ? s.default : s;
    }
    function Gc(s) {
      if (s.__esModule) return s;
      var e = s.default;
      if (typeof e == "function") {
        var t = function r() {
          return this instanceof r ? Reflect.construct(e, arguments, this.constructor) : e.apply(this, arguments);
        };
        t.prototype = e.prototype;
      } else t = {};
      return (
        Object.defineProperty(t, "__esModule", { value: !0 }),
        Object.keys(s).forEach(function (r) {
          var i = Object.getOwnPropertyDescriptor(s, r);
          Object.defineProperty(
            t,
            r,
            i.get
              ? i
              : {
                  enumerable: !0,
                  get: function () {
                    return s[r];
                  },
                },
          );
        }),
        t
      );
    }
    var Qs = { exports: {} },
      G = String,
      ko = function () {
        return {
          isColorSupported: !1,
          reset: G,
          bold: G,
          dim: G,
          italic: G,
          underline: G,
          inverse: G,
          hidden: G,
          strikethrough: G,
          black: G,
          red: G,
          green: G,
          yellow: G,
          blue: G,
          magenta: G,
          cyan: G,
          white: G,
          gray: G,
          bgBlack: G,
          bgRed: G,
          bgGreen: G,
          bgYellow: G,
          bgBlue: G,
          bgMagenta: G,
          bgCyan: G,
          bgWhite: G,
        };
      };
    Qs.exports = ko();
    Qs.exports.createColors = ko;
    var jc = Qs.exports;
    const Yc = {},
      Hc = Object.freeze(
        Object.defineProperty({ __proto__: null, default: Yc }, Symbol.toStringTag, { value: "Module" }),
      ),
      ce = Gc(Hc);
    let nn = jc,
      on = ce,
      gs = class $o extends Error {
        constructor(e, t, r, i, o, n) {
          super(e),
            (this.name = "CssSyntaxError"),
            (this.reason = e),
            o && (this.file = o),
            i && (this.source = i),
            n && (this.plugin = n),
            typeof t != "undefined" &&
              typeof r != "undefined" &&
              (typeof t == "number"
                ? ((this.line = t), (this.column = r))
                : ((this.line = t.line),
                  (this.column = t.column),
                  (this.endLine = r.line),
                  (this.endColumn = r.column))),
            this.setMessage(),
            Error.captureStackTrace && Error.captureStackTrace(this, $o);
        }
        setMessage() {
          (this.message = this.plugin ? this.plugin + ": " : ""),
            (this.message += this.file ? this.file : "<css input>"),
            typeof this.line != "undefined" && (this.message += ":" + this.line + ":" + this.column),
            (this.message += ": " + this.reason);
        }
        showSourceCode(e) {
          if (!this.source) return "";
          let t = this.source;
          e == null && (e = nn.isColorSupported), on && e && (t = on(t));
          let r = t.split(/\r?\n/),
            i = Math.max(this.line - 3, 0),
            o = Math.min(this.line + 2, r.length),
            n = String(o).length,
            a,
            l;
          if (e) {
            let { bold: u, gray: c, red: h } = nn.createColors(!0);
            (a = (f) => u(h(f))), (l = (f) => c(f));
          } else a = l = (u) => u;
          return r.slice(i, o).map((u, c) => {
            let h = i + 1 + c,
              f = " " + (" " + h).slice(-n) + " | ";
            if (h === this.line) {
              let p = l(f.replace(/\d/g, " ")) + u.slice(0, this.column - 1).replace(/[^\t]/g, " ");
              return (
                a(">") +
                l(f) +
                u +
                `
` +
                p +
                a("^")
              );
            }
            return " " + l(f) + u;
          }).join(`
`);
        }
        toString() {
          let e = this.showSourceCode();
          return (
            e &&
              (e =
                `

` +
                e +
                `
`),
            this.name + ": " + this.message + e
          );
        }
      };
    var qs = gs;
    gs.default = gs;
    var It = {};
    It.isClean = Symbol("isClean");
    It.my = Symbol("my");
    const an = {
      after: `
`,
      beforeClose: `
`,
      beforeComment: `
`,
      beforeDecl: `
`,
      beforeOpen: " ",
      beforeRule: `
`,
      colon: ": ",
      commentLeft: " ",
      commentRight: " ",
      emptyBody: "",
      indent: "    ",
      semicolon: !1,
    };
    function Zc(s) {
      return s[0].toUpperCase() + s.slice(1);
    }
    let ys = class {
      constructor(e) {
        this.builder = e;
      }
      atrule(e, t) {
        let r = "@" + e.name,
          i = e.params ? this.rawValue(e, "params") : "";
        if ((typeof e.raws.afterName != "undefined" ? (r += e.raws.afterName) : i && (r += " "), e.nodes))
          this.block(e, r + i);
        else {
          let o = (e.raws.between || "") + (t ? ";" : "");
          this.builder(r + i + o, e);
        }
      }
      beforeAfter(e, t) {
        let r;
        e.type === "decl"
          ? (r = this.raw(e, null, "beforeDecl"))
          : e.type === "comment"
          ? (r = this.raw(e, null, "beforeComment"))
          : t === "before"
          ? (r = this.raw(e, null, "beforeRule"))
          : (r = this.raw(e, null, "beforeClose"));
        let i = e.parent,
          o = 0;
        for (; i && i.type !== "root"; ) (o += 1), (i = i.parent);
        if (
          r.includes(`
`)
        ) {
          let n = this.raw(e, null, "indent");
          if (n.length) for (let a = 0; a < o; a++) r += n;
        }
        return r;
      }
      block(e, t) {
        let r = this.raw(e, "between", "beforeOpen");
        this.builder(t + r + "{", e, "start");
        let i;
        e.nodes && e.nodes.length
          ? (this.body(e), (i = this.raw(e, "after")))
          : (i = this.raw(e, "after", "emptyBody")),
          i && this.builder(i),
          this.builder("}", e, "end");
      }
      body(e) {
        let t = e.nodes.length - 1;
        for (; t > 0 && e.nodes[t].type === "comment"; ) t -= 1;
        let r = this.raw(e, "semicolon");
        for (let i = 0; i < e.nodes.length; i++) {
          let o = e.nodes[i],
            n = this.raw(o, "before");
          n && this.builder(n), this.stringify(o, t !== i || r);
        }
      }
      comment(e) {
        let t = this.raw(e, "left", "commentLeft"),
          r = this.raw(e, "right", "commentRight");
        this.builder("/*" + t + e.text + r + "*/", e);
      }
      decl(e, t) {
        let r = this.raw(e, "between", "colon"),
          i = e.prop + r + this.rawValue(e, "value");
        e.important && (i += e.raws.important || " !important"), t && (i += ";"), this.builder(i, e);
      }
      document(e) {
        this.body(e);
      }
      raw(e, t, r) {
        let i;
        if ((r || (r = t), t && ((i = e.raws[t]), typeof i != "undefined"))) return i;
        let o = e.parent;
        if (r === "before" && (!o || (o.type === "root" && o.first === e) || (o && o.type === "document"))) return "";
        if (!o) return an[r];
        let n = e.root();
        if ((n.rawCache || (n.rawCache = {}), typeof n.rawCache[r] != "undefined")) return n.rawCache[r];
        if (r === "before" || r === "after") return this.beforeAfter(e, r);
        {
          let a = "raw" + Zc(r);
          this[a]
            ? (i = this[a](n, e))
            : n.walk((l) => {
                if (((i = l.raws[t]), typeof i != "undefined")) return !1;
              });
        }
        return typeof i == "undefined" && (i = an[r]), (n.rawCache[r] = i), i;
      }
      rawBeforeClose(e) {
        let t;
        return (
          e.walk((r) => {
            if (r.nodes && r.nodes.length > 0 && typeof r.raws.after != "undefined")
              return (
                (t = r.raws.after),
                t.includes(`
`) && (t = t.replace(/[^\n]+$/, "")),
                !1
              );
          }),
          t && (t = t.replace(/\S/g, "")),
          t
        );
      }
      rawBeforeComment(e, t) {
        let r;
        return (
          e.walkComments((i) => {
            if (typeof i.raws.before != "undefined")
              return (
                (r = i.raws.before),
                r.includes(`
`) && (r = r.replace(/[^\n]+$/, "")),
                !1
              );
          }),
          typeof r == "undefined" ? (r = this.raw(t, null, "beforeDecl")) : r && (r = r.replace(/\S/g, "")),
          r
        );
      }
      rawBeforeDecl(e, t) {
        let r;
        return (
          e.walkDecls((i) => {
            if (typeof i.raws.before != "undefined")
              return (
                (r = i.raws.before),
                r.includes(`
`) && (r = r.replace(/[^\n]+$/, "")),
                !1
              );
          }),
          typeof r == "undefined" ? (r = this.raw(t, null, "beforeRule")) : r && (r = r.replace(/\S/g, "")),
          r
        );
      }
      rawBeforeOpen(e) {
        let t;
        return (
          e.walk((r) => {
            if (r.type !== "decl" && ((t = r.raws.between), typeof t != "undefined")) return !1;
          }),
          t
        );
      }
      rawBeforeRule(e) {
        let t;
        return (
          e.walk((r) => {
            if (r.nodes && (r.parent !== e || e.first !== r) && typeof r.raws.before != "undefined")
              return (
                (t = r.raws.before),
                t.includes(`
`) && (t = t.replace(/[^\n]+$/, "")),
                !1
              );
          }),
          t && (t = t.replace(/\S/g, "")),
          t
        );
      }
      rawColon(e) {
        let t;
        return (
          e.walkDecls((r) => {
            if (typeof r.raws.between != "undefined") return (t = r.raws.between.replace(/[^\s:]/g, "")), !1;
          }),
          t
        );
      }
      rawEmptyBody(e) {
        let t;
        return (
          e.walk((r) => {
            if (r.nodes && r.nodes.length === 0 && ((t = r.raws.after), typeof t != "undefined")) return !1;
          }),
          t
        );
      }
      rawIndent(e) {
        if (e.raws.indent) return e.raws.indent;
        let t;
        return (
          e.walk((r) => {
            let i = r.parent;
            if (i && i !== e && i.parent && i.parent === e && typeof r.raws.before != "undefined") {
              let o = r.raws.before.split(`
`);
              return (t = o[o.length - 1]), (t = t.replace(/\S/g, "")), !1;
            }
          }),
          t
        );
      }
      rawSemicolon(e) {
        let t;
        return (
          e.walk((r) => {
            if (
              r.nodes &&
              r.nodes.length &&
              r.last.type === "decl" &&
              ((t = r.raws.semicolon), typeof t != "undefined")
            )
              return !1;
          }),
          t
        );
      }
      rawValue(e, t) {
        let r = e[t],
          i = e.raws[t];
        return i && i.value === r ? i.raw : r;
      }
      root(e) {
        this.body(e), e.raws.after && this.builder(e.raws.after);
      }
      rule(e) {
        this.block(e, this.rawValue(e, "selector")), e.raws.ownSemicolon && this.builder(e.raws.ownSemicolon, e, "end");
      }
      stringify(e, t) {
        if (!this[e.type])
          throw new Error("Unknown AST node type " + e.type + ". Maybe you need to change PostCSS stringifier.");
        this[e.type](e, t);
      }
    };
    var Po = ys;
    ys.default = ys;
    let Xc = Po;
    function ws(s, e) {
      new Xc(e).stringify(s);
    }
    var Or = ws;
    ws.default = ws;
    let { isClean: Wt, my: Jc } = It,
      Kc = qs,
      Qc = Po,
      qc = Or;
    function bs(s, e) {
      let t = new s.constructor();
      for (let r in s) {
        if (!Object.prototype.hasOwnProperty.call(s, r) || r === "proxyCache") continue;
        let i = s[r],
          o = typeof i;
        r === "parent" && o === "object"
          ? e && (t[r] = e)
          : r === "source"
          ? (t[r] = i)
          : Array.isArray(i)
          ? (t[r] = i.map((n) => bs(n, t)))
          : (o === "object" && i !== null && (i = bs(i)), (t[r] = i));
      }
      return t;
    }
    let Ss = class {
      constructor(e = {}) {
        (this.raws = {}), (this[Wt] = !1), (this[Jc] = !0);
        for (let t in e)
          if (t === "nodes") {
            this.nodes = [];
            for (let r of e[t]) typeof r.clone == "function" ? this.append(r.clone()) : this.append(r);
          } else this[t] = e[t];
      }
      addToError(e) {
        if (((e.postcssNode = this), e.stack && this.source && /\n\s{4}at /.test(e.stack))) {
          let t = this.source;
          e.stack = e.stack.replace(/\n\s{4}at /, `$&${t.input.from}:${t.start.line}:${t.start.column}$&`);
        }
        return e;
      }
      after(e) {
        return this.parent.insertAfter(this, e), this;
      }
      assign(e = {}) {
        for (let t in e) this[t] = e[t];
        return this;
      }
      before(e) {
        return this.parent.insertBefore(this, e), this;
      }
      cleanRaws(e) {
        delete this.raws.before, delete this.raws.after, e || delete this.raws.between;
      }
      clone(e = {}) {
        let t = bs(this);
        for (let r in e) t[r] = e[r];
        return t;
      }
      cloneAfter(e = {}) {
        let t = this.clone(e);
        return this.parent.insertAfter(this, t), t;
      }
      cloneBefore(e = {}) {
        let t = this.clone(e);
        return this.parent.insertBefore(this, t), t;
      }
      error(e, t = {}) {
        if (this.source) {
          let { end: r, start: i } = this.rangeBy(t);
          return this.source.input.error(e, { column: i.column, line: i.line }, { column: r.column, line: r.line }, t);
        }
        return new Kc(e);
      }
      getProxyProcessor() {
        return {
          get(e, t) {
            return t === "proxyOf" ? e : t === "root" ? () => e.root().toProxy() : e[t];
          },
          set(e, t, r) {
            return (
              e[t] === r ||
                ((e[t] = r),
                (t === "prop" ||
                  t === "value" ||
                  t === "name" ||
                  t === "params" ||
                  t === "important" ||
                  t === "text") &&
                  e.markDirty()),
              !0
            );
          },
        };
      }
      markDirty() {
        if (this[Wt]) {
          this[Wt] = !1;
          let e = this;
          for (; (e = e.parent); ) e[Wt] = !1;
        }
      }
      next() {
        if (!this.parent) return;
        let e = this.parent.index(this);
        return this.parent.nodes[e + 1];
      }
      positionBy(e, t) {
        let r = this.source.start;
        if (e.index) r = this.positionInside(e.index, t);
        else if (e.word) {
          t = this.toString();
          let i = t.indexOf(e.word);
          i !== -1 && (r = this.positionInside(i, t));
        }
        return r;
      }
      positionInside(e, t) {
        let r = t || this.toString(),
          i = this.source.start.column,
          o = this.source.start.line;
        for (let n = 0; n < e; n++)
          r[n] ===
          `
`
            ? ((i = 1), (o += 1))
            : (i += 1);
        return { column: i, line: o };
      }
      prev() {
        if (!this.parent) return;
        let e = this.parent.index(this);
        return this.parent.nodes[e - 1];
      }
      rangeBy(e) {
        let t = {
            column: this.source.start.column,
            line: this.source.start.line,
          },
          r = this.source.end
            ? { column: this.source.end.column + 1, line: this.source.end.line }
            : { column: t.column + 1, line: t.line };
        if (e.word) {
          let i = this.toString(),
            o = i.indexOf(e.word);
          o !== -1 && ((t = this.positionInside(o, i)), (r = this.positionInside(o + e.word.length, i)));
        } else
          e.start
            ? (t = { column: e.start.column, line: e.start.line })
            : e.index && (t = this.positionInside(e.index)),
            e.end
              ? (r = { column: e.end.column, line: e.end.line })
              : typeof e.endIndex == "number"
              ? (r = this.positionInside(e.endIndex))
              : e.index && (r = this.positionInside(e.index + 1));
        return (
          (r.line < t.line || (r.line === t.line && r.column <= t.column)) &&
            (r = { column: t.column + 1, line: t.line }),
          { end: r, start: t }
        );
      }
      raw(e, t) {
        return new Qc().raw(this, e, t);
      }
      remove() {
        return this.parent && this.parent.removeChild(this), (this.parent = void 0), this;
      }
      replaceWith(...e) {
        if (this.parent) {
          let t = this,
            r = !1;
          for (let i of e)
            i === this ? (r = !0) : r ? (this.parent.insertAfter(t, i), (t = i)) : this.parent.insertBefore(t, i);
          r || this.remove();
        }
        return this;
      }
      root() {
        let e = this;
        for (; e.parent && e.parent.type !== "document"; ) e = e.parent;
        return e;
      }
      toJSON(e, t) {
        let r = {},
          i = t == null;
        t = t || new Map();
        let o = 0;
        for (let n in this) {
          if (!Object.prototype.hasOwnProperty.call(this, n) || n === "parent" || n === "proxyCache") continue;
          let a = this[n];
          if (Array.isArray(a)) r[n] = a.map((l) => (typeof l == "object" && l.toJSON ? l.toJSON(null, t) : l));
          else if (typeof a == "object" && a.toJSON) r[n] = a.toJSON(null, t);
          else if (n === "source") {
            let l = t.get(a.input);
            l == null && ((l = o), t.set(a.input, o), o++), (r[n] = { end: a.end, inputId: l, start: a.start });
          } else r[n] = a;
        }
        return i && (r.inputs = [...t.keys()].map((n) => n.toJSON())), r;
      }
      toProxy() {
        return this.proxyCache || (this.proxyCache = new Proxy(this, this.getProxyProcessor())), this.proxyCache;
      }
      toString(e = qc) {
        e.stringify && (e = e.stringify);
        let t = "";
        return (
          e(this, (r) => {
            t += r;
          }),
          t
        );
      }
      warn(e, t, r) {
        let i = { node: this };
        for (let o in r) i[o] = r[o];
        return e.warn(t, i);
      }
      get proxyOf() {
        return this;
      }
    };
    var Dr = Ss;
    Ss.default = Ss;
    let eh = Dr,
      vs = class extends eh {
        constructor(e) {
          e &&
            typeof e.value != "undefined" &&
            typeof e.value != "string" &&
            (e = Q(R({}, e), { value: String(e.value) })),
            super(e),
            (this.type = "decl");
        }
        get variable() {
          return this.prop.startsWith("--") || this.prop[0] === "$";
        }
      };
    var Tr = vs;
    vs.default = vs;
    let th = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict",
      rh =
        (s, e = 21) =>
        (t = e) => {
          let r = "",
            i = t;
          for (; i--; ) r += s[(Math.random() * s.length) | 0];
          return r;
        },
      sh = (s = 21) => {
        let e = "",
          t = s;
        for (; t--; ) e += th[(Math.random() * 64) | 0];
        return e;
      };
    var ih = { nanoid: sh, customAlphabet: rh };
    let { SourceMapConsumer: ln, SourceMapGenerator: un } = ce,
      { existsSync: nh, readFileSync: oh } = ce,
      { dirname: Yr, join: ah } = ce;
    function lh(s) {
      return Buffer ? Buffer.from(s, "base64").toString() : window.atob(s);
    }
    let Cs = class {
      constructor(e, t) {
        if (t.map === !1) return;
        this.loadAnnotation(e), (this.inline = this.startWith(this.annotation, "data:"));
        let r = t.map ? t.map.prev : void 0,
          i = this.loadMap(t.from, r);
        !this.mapFile && t.from && (this.mapFile = t.from),
          this.mapFile && (this.root = Yr(this.mapFile)),
          i && (this.text = i);
      }
      consumer() {
        return this.consumerCache || (this.consumerCache = new ln(this.text)), this.consumerCache;
      }
      decodeInline(e) {
        let t = /^data:application\/json;charset=utf-?8;base64,/,
          r = /^data:application\/json;base64,/,
          i = /^data:application\/json;charset=utf-?8,/,
          o = /^data:application\/json,/;
        if (i.test(e) || o.test(e)) return decodeURIComponent(e.substr(RegExp.lastMatch.length));
        if (t.test(e) || r.test(e)) return lh(e.substr(RegExp.lastMatch.length));
        let n = e.match(/data:application\/json;([^,]+),/)[1];
        throw new Error("Unsupported source map encoding " + n);
      }
      getAnnotationURL(e) {
        return e.replace(/^\/\*\s*# sourceMappingURL=/, "").trim();
      }
      isMap(e) {
        return typeof e != "object"
          ? !1
          : typeof e.mappings == "string" || typeof e._mappings == "string" || Array.isArray(e.sections);
      }
      loadAnnotation(e) {
        let t = e.match(/\/\*\s*# sourceMappingURL=/gm);
        if (!t) return;
        let r = e.lastIndexOf(t.pop()),
          i = e.indexOf("*/", r);
        r > -1 && i > -1 && (this.annotation = this.getAnnotationURL(e.substring(r, i)));
      }
      loadFile(e) {
        if (((this.root = Yr(e)), nh(e))) return (this.mapFile = e), oh(e, "utf-8").toString().trim();
      }
      loadMap(e, t) {
        if (t === !1) return !1;
        if (t) {
          if (typeof t == "string") return t;
          if (typeof t == "function") {
            let r = t(e);
            if (r) {
              let i = this.loadFile(r);
              if (!i) throw new Error("Unable to load previous source map: " + r.toString());
              return i;
            }
          } else {
            if (t instanceof ln) return un.fromSourceMap(t).toString();
            if (t instanceof un) return t.toString();
            if (this.isMap(t)) return JSON.stringify(t);
            throw new Error("Unsupported previous source map format: " + t.toString());
          }
        } else {
          if (this.inline) return this.decodeInline(this.annotation);
          if (this.annotation) {
            let r = this.annotation;
            return e && (r = ah(Yr(e), r)), this.loadFile(r);
          }
        }
      }
      startWith(e, t) {
        return e ? e.substr(0, t.length) === t : !1;
      }
      withContent() {
        return !!(this.consumer().sourcesContent && this.consumer().sourcesContent.length > 0);
      }
    };
    var Lo = Cs;
    Cs.default = Cs;
    let { SourceMapConsumer: uh, SourceMapGenerator: ch } = ce,
      { fileURLToPath: cn, pathToFileURL: zt } = ce,
      { isAbsolute: Es, resolve: Is } = ce,
      { nanoid: hh } = ih,
      Hr = ce,
      hn = qs,
      fh = Lo,
      Zr = Symbol("fromOffsetCache"),
      dh = !!(uh && ch),
      fn = !!(Is && Es),
      mr = class {
        constructor(e, t = {}) {
          if (e === null || typeof e == "undefined" || (typeof e == "object" && !e.toString))
            throw new Error(`PostCSS received ${e} instead of CSS string`);
          if (
            ((this.css = e.toString()),
            this.css[0] === "\uFEFF" || this.css[0] === "\uFFFE"
              ? ((this.hasBOM = !0), (this.css = this.css.slice(1)))
              : (this.hasBOM = !1),
            t.from && (!fn || /^\w+:\/\//.test(t.from) || Es(t.from) ? (this.file = t.from) : (this.file = Is(t.from))),
            fn && dh)
          ) {
            let r = new fh(this.css, t);
            if (r.text) {
              this.map = r;
              let i = r.consumer().file;
              !this.file && i && (this.file = this.mapResolve(i));
            }
          }
          this.file || (this.id = "<input css " + hh(6) + ">"), this.map && (this.map.file = this.from);
        }
        error(e, t, r, i = {}) {
          let o, n, a;
          if (t && typeof t == "object") {
            let u = t,
              c = r;
            if (typeof u.offset == "number") {
              let h = this.fromOffset(u.offset);
              (t = h.line), (r = h.col);
            } else (t = u.line), (r = u.column);
            if (typeof c.offset == "number") {
              let h = this.fromOffset(c.offset);
              (n = h.line), (a = h.col);
            } else (n = c.line), (a = c.column);
          } else if (!r) {
            let u = this.fromOffset(t);
            (t = u.line), (r = u.col);
          }
          let l = this.origin(t, r, n, a);
          return (
            l
              ? (o = new hn(
                  e,
                  l.endLine === void 0 ? l.line : { column: l.column, line: l.line },
                  l.endLine === void 0 ? l.column : { column: l.endColumn, line: l.endLine },
                  l.source,
                  l.file,
                  i.plugin,
                ))
              : (o = new hn(
                  e,
                  n === void 0 ? t : { column: r, line: t },
                  n === void 0 ? r : { column: a, line: n },
                  this.css,
                  this.file,
                  i.plugin,
                )),
            (o.input = {
              column: r,
              endColumn: a,
              endLine: n,
              line: t,
              source: this.css,
            }),
            this.file && (zt && (o.input.url = zt(this.file).toString()), (o.input.file = this.file)),
            o
          );
        }
        fromOffset(e) {
          let t, r;
          if (this[Zr]) r = this[Zr];
          else {
            let o = this.css.split(`
`);
            r = new Array(o.length);
            let n = 0;
            for (let a = 0, l = o.length; a < l; a++) (r[a] = n), (n += o[a].length + 1);
            this[Zr] = r;
          }
          t = r[r.length - 1];
          let i = 0;
          if (e >= t) i = r.length - 1;
          else {
            let o = r.length - 2,
              n;
            for (; i < o; )
              if (((n = i + ((o - i) >> 1)), e < r[n])) o = n - 1;
              else if (e >= r[n + 1]) i = n + 1;
              else {
                i = n;
                break;
              }
          }
          return { col: e - r[i] + 1, line: i + 1 };
        }
        mapResolve(e) {
          return /^\w+:\/\//.test(e) ? e : Is(this.map.consumer().sourceRoot || this.map.root || ".", e);
        }
        origin(e, t, r, i) {
          if (!this.map) return !1;
          let o = this.map.consumer(),
            n = o.originalPositionFor({ column: t, line: e });
          if (!n.source) return !1;
          let a;
          typeof r == "number" && (a = o.originalPositionFor({ column: i, line: r }));
          let l;
          Es(n.source)
            ? (l = zt(n.source))
            : (l = new URL(n.source, this.map.consumer().sourceRoot || zt(this.map.mapFile)));
          let u = {
            column: n.column,
            endColumn: a && a.column,
            endLine: a && a.line,
            line: n.line,
            url: l.toString(),
          };
          if (l.protocol === "file:")
            if (cn) u.file = cn(l);
            else throw new Error("file: protocol is not available in this PostCSS build");
          let c = o.sourceContentFor(n.source);
          return c && (u.source = c), u;
        }
        toJSON() {
          let e = {};
          for (let t of ["hasBOM", "css", "file", "id"]) this[t] != null && (e[t] = this[t]);
          return this.map && ((e.map = R({}, this.map)), e.map.consumerCache && (e.map.consumerCache = void 0)), e;
        }
        get from() {
          return this.file || this.id;
        }
      };
    var _r = mr;
    mr.default = mr;
    Hr && Hr.registerInput && Hr.registerInput(mr);
    let { SourceMapConsumer: Fo, SourceMapGenerator: sr } = ce,
      { dirname: ir, relative: Bo, resolve: Uo, sep: Wo } = ce,
      { pathToFileURL: dn } = ce,
      ph = _r,
      mh = !!(Fo && sr),
      gh = !!(ir && Uo && Bo && Wo),
      yh = class {
        constructor(e, t, r, i) {
          (this.stringify = e),
            (this.mapOpts = r.map || {}),
            (this.root = t),
            (this.opts = r),
            (this.css = i),
            (this.originalCSS = i),
            (this.usesFileUrls = !this.mapOpts.from && this.mapOpts.absolute),
            (this.memoizedFileURLs = new Map()),
            (this.memoizedPaths = new Map()),
            (this.memoizedURLs = new Map());
        }
        addAnnotation() {
          let e;
          this.isInline()
            ? (e = "data:application/json;base64," + this.toBase64(this.map.toString()))
            : typeof this.mapOpts.annotation == "string"
            ? (e = this.mapOpts.annotation)
            : typeof this.mapOpts.annotation == "function"
            ? (e = this.mapOpts.annotation(this.opts.to, this.root))
            : (e = this.outputFile() + ".map");
          let t = `
`;
          this.css.includes(`\r
`) &&
            (t = `\r
`),
            (this.css += t + "/*# sourceMappingURL=" + e + " */");
        }
        applyPrevMaps() {
          for (let e of this.previous()) {
            let t = this.toUrl(this.path(e.file)),
              r = e.root || ir(e.file),
              i;
            this.mapOpts.sourcesContent === !1
              ? ((i = new Fo(e.text)), i.sourcesContent && (i.sourcesContent = null))
              : (i = e.consumer()),
              this.map.applySourceMap(i, t, this.toUrl(this.path(r)));
          }
        }
        clearAnnotation() {
          if (this.mapOpts.annotation !== !1)
            if (this.root) {
              let e;
              for (let t = this.root.nodes.length - 1; t >= 0; t--)
                (e = this.root.nodes[t]),
                  e.type === "comment" && e.text.indexOf("# sourceMappingURL=") === 0 && this.root.removeChild(t);
            } else this.css && (this.css = this.css.replace(/\n*?\/\*#[\S\s]*?\*\/$/gm, ""));
        }
        generate() {
          if ((this.clearAnnotation(), gh && mh && this.isMap())) return this.generateMap();
          {
            let e = "";
            return (
              this.stringify(this.root, (t) => {
                e += t;
              }),
              [e]
            );
          }
        }
        generateMap() {
          if (this.root) this.generateString();
          else if (this.previous().length === 1) {
            let e = this.previous()[0].consumer();
            (e.file = this.outputFile()), (this.map = sr.fromSourceMap(e, { ignoreInvalidMapping: !0 }));
          } else
            (this.map = new sr({
              file: this.outputFile(),
              ignoreInvalidMapping: !0,
            })),
              this.map.addMapping({
                generated: { column: 0, line: 1 },
                original: { column: 0, line: 1 },
                source: this.opts.from ? this.toUrl(this.path(this.opts.from)) : "<no source>",
              });
          return (
            this.isSourcesContent() && this.setSourcesContent(),
            this.root && this.previous().length > 0 && this.applyPrevMaps(),
            this.isAnnotation() && this.addAnnotation(),
            this.isInline() ? [this.css] : [this.css, this.map]
          );
        }
        generateString() {
          (this.css = ""),
            (this.map = new sr({
              file: this.outputFile(),
              ignoreInvalidMapping: !0,
            }));
          let e = 1,
            t = 1,
            r = "<no source>",
            i = {
              generated: { column: 0, line: 0 },
              original: { column: 0, line: 0 },
              source: "",
            },
            o,
            n;
          this.stringify(this.root, (a, l, u) => {
            if (
              ((this.css += a),
              l &&
                u !== "end" &&
                ((i.generated.line = e),
                (i.generated.column = t - 1),
                l.source && l.source.start
                  ? ((i.source = this.sourcePath(l)),
                    (i.original.line = l.source.start.line),
                    (i.original.column = l.source.start.column - 1),
                    this.map.addMapping(i))
                  : ((i.source = r), (i.original.line = 1), (i.original.column = 0), this.map.addMapping(i))),
              (o = a.match(/\n/g)),
              o
                ? ((e += o.length),
                  (n = a.lastIndexOf(`
`)),
                  (t = a.length - n))
                : (t += a.length),
              l && u !== "start")
            ) {
              let c = l.parent || { raws: {} };
              (!(l.type === "decl" || (l.type === "atrule" && !l.nodes)) || l !== c.last || c.raws.semicolon) &&
                (l.source && l.source.end
                  ? ((i.source = this.sourcePath(l)),
                    (i.original.line = l.source.end.line),
                    (i.original.column = l.source.end.column - 1),
                    (i.generated.line = e),
                    (i.generated.column = t - 2),
                    this.map.addMapping(i))
                  : ((i.source = r),
                    (i.original.line = 1),
                    (i.original.column = 0),
                    (i.generated.line = e),
                    (i.generated.column = t - 1),
                    this.map.addMapping(i)));
            }
          });
        }
        isAnnotation() {
          return this.isInline()
            ? !0
            : typeof this.mapOpts.annotation != "undefined"
            ? this.mapOpts.annotation
            : this.previous().length
            ? this.previous().some((e) => e.annotation)
            : !0;
        }
        isInline() {
          if (typeof this.mapOpts.inline != "undefined") return this.mapOpts.inline;
          let e = this.mapOpts.annotation;
          return typeof e != "undefined" && e !== !0
            ? !1
            : this.previous().length
            ? this.previous().some((t) => t.inline)
            : !0;
        }
        isMap() {
          return typeof this.opts.map != "undefined" ? !!this.opts.map : this.previous().length > 0;
        }
        isSourcesContent() {
          return typeof this.mapOpts.sourcesContent != "undefined"
            ? this.mapOpts.sourcesContent
            : this.previous().length
            ? this.previous().some((e) => e.withContent())
            : !0;
        }
        outputFile() {
          return this.opts.to ? this.path(this.opts.to) : this.opts.from ? this.path(this.opts.from) : "to.css";
        }
        path(e) {
          if (this.mapOpts.absolute || e.charCodeAt(0) === 60 || /^\w+:\/\//.test(e)) return e;
          let t = this.memoizedPaths.get(e);
          if (t) return t;
          let r = this.opts.to ? ir(this.opts.to) : ".";
          typeof this.mapOpts.annotation == "string" && (r = ir(Uo(r, this.mapOpts.annotation)));
          let i = Bo(r, e);
          return this.memoizedPaths.set(e, i), i;
        }
        previous() {
          if (!this.previousMaps)
            if (((this.previousMaps = []), this.root))
              this.root.walk((e) => {
                if (e.source && e.source.input.map) {
                  let t = e.source.input.map;
                  this.previousMaps.includes(t) || this.previousMaps.push(t);
                }
              });
            else {
              let e = new ph(this.originalCSS, this.opts);
              e.map && this.previousMaps.push(e.map);
            }
          return this.previousMaps;
        }
        setSourcesContent() {
          let e = {};
          if (this.root)
            this.root.walk((t) => {
              if (t.source) {
                let r = t.source.input.from;
                if (r && !e[r]) {
                  e[r] = !0;
                  let i = this.usesFileUrls ? this.toFileUrl(r) : this.toUrl(this.path(r));
                  this.map.setSourceContent(i, t.source.input.css);
                }
              }
            });
          else if (this.css) {
            let t = this.opts.from ? this.toUrl(this.path(this.opts.from)) : "<no source>";
            this.map.setSourceContent(t, this.css);
          }
        }
        sourcePath(e) {
          return this.mapOpts.from
            ? this.toUrl(this.mapOpts.from)
            : this.usesFileUrls
            ? this.toFileUrl(e.source.input.from)
            : this.toUrl(this.path(e.source.input.from));
        }
        toBase64(e) {
          return Buffer ? Buffer.from(e).toString("base64") : window.btoa(unescape(encodeURIComponent(e)));
        }
        toFileUrl(e) {
          let t = this.memoizedFileURLs.get(e);
          if (t) return t;
          if (dn) {
            let r = dn(e).toString();
            return this.memoizedFileURLs.set(e, r), r;
          } else throw new Error("`map.absolute` option is not available in this PostCSS build");
        }
        toUrl(e) {
          let t = this.memoizedURLs.get(e);
          if (t) return t;
          Wo === "\\" && (e = e.replace(/\\/g, "/"));
          let r = encodeURI(e).replace(/[#?]/g, encodeURIComponent);
          return this.memoizedURLs.set(e, r), r;
        }
      };
    var zo = yh;
    let wh = Dr,
      xs = class extends wh {
        constructor(e) {
          super(e), (this.type = "comment");
        }
      };
    var kr = xs;
    xs.default = xs;
    let { isClean: Vo, my: Go } = It,
      jo = Tr,
      Yo = kr,
      bh = Dr,
      Ho,
      ei,
      ti,
      Zo;
    function Xo(s) {
      return s.map((e) => (e.nodes && (e.nodes = Xo(e.nodes)), delete e.source, e));
    }
    function Jo(s) {
      if (((s[Vo] = !1), s.proxyOf.nodes)) for (let e of s.proxyOf.nodes) Jo(e);
    }
    let be = class Ko extends bh {
      append(...e) {
        for (let t of e) {
          let r = this.normalize(t, this.last);
          for (let i of r) this.proxyOf.nodes.push(i);
        }
        return this.markDirty(), this;
      }
      cleanRaws(e) {
        if ((super.cleanRaws(e), this.nodes)) for (let t of this.nodes) t.cleanRaws(e);
      }
      each(e) {
        if (!this.proxyOf.nodes) return;
        let t = this.getIterator(),
          r,
          i;
        for (
          ;
          this.indexes[t] < this.proxyOf.nodes.length &&
          ((r = this.indexes[t]), (i = e(this.proxyOf.nodes[r], r)), i !== !1);

        )
          this.indexes[t] += 1;
        return delete this.indexes[t], i;
      }
      every(e) {
        return this.nodes.every(e);
      }
      getIterator() {
        this.lastEach || (this.lastEach = 0), this.indexes || (this.indexes = {}), (this.lastEach += 1);
        let e = this.lastEach;
        return (this.indexes[e] = 0), e;
      }
      getProxyProcessor() {
        return {
          get(e, t) {
            return t === "proxyOf"
              ? e
              : e[t]
              ? t === "each" || (typeof t == "string" && t.startsWith("walk"))
                ? (...r) => e[t](...r.map((i) => (typeof i == "function" ? (o, n) => i(o.toProxy(), n) : i)))
                : t === "every" || t === "some"
                ? (r) => e[t]((i, ...o) => r(i.toProxy(), ...o))
                : t === "root"
                ? () => e.root().toProxy()
                : t === "nodes"
                ? e.nodes.map((r) => r.toProxy())
                : t === "first" || t === "last"
                ? e[t].toProxy()
                : e[t]
              : e[t];
          },
          set(e, t, r) {
            return (
              e[t] === r || ((e[t] = r), (t === "name" || t === "params" || t === "selector") && e.markDirty()), !0
            );
          },
        };
      }
      index(e) {
        return typeof e == "number" ? e : (e.proxyOf && (e = e.proxyOf), this.proxyOf.nodes.indexOf(e));
      }
      insertAfter(e, t) {
        let r = this.index(e),
          i = this.normalize(t, this.proxyOf.nodes[r]).reverse();
        r = this.index(e);
        for (let n of i) this.proxyOf.nodes.splice(r + 1, 0, n);
        let o;
        for (let n in this.indexes) (o = this.indexes[n]), r < o && (this.indexes[n] = o + i.length);
        return this.markDirty(), this;
      }
      insertBefore(e, t) {
        let r = this.index(e),
          i = r === 0 ? "prepend" : !1,
          o = this.normalize(t, this.proxyOf.nodes[r], i).reverse();
        r = this.index(e);
        for (let a of o) this.proxyOf.nodes.splice(r, 0, a);
        let n;
        for (let a in this.indexes) (n = this.indexes[a]), r <= n && (this.indexes[a] = n + o.length);
        return this.markDirty(), this;
      }
      normalize(e, t) {
        if (typeof e == "string") e = Xo(Ho(e).nodes);
        else if (typeof e == "undefined") e = [];
        else if (Array.isArray(e)) {
          e = e.slice(0);
          for (let i of e) i.parent && i.parent.removeChild(i, "ignore");
        } else if (e.type === "root" && this.type !== "document") {
          e = e.nodes.slice(0);
          for (let i of e) i.parent && i.parent.removeChild(i, "ignore");
        } else if (e.type) e = [e];
        else if (e.prop) {
          if (typeof e.value == "undefined") throw new Error("Value field is missed in node creation");
          typeof e.value != "string" && (e.value = String(e.value)), (e = [new jo(e)]);
        } else if (e.selector) e = [new ei(e)];
        else if (e.name) e = [new ti(e)];
        else if (e.text) e = [new Yo(e)];
        else throw new Error("Unknown node type in node creation");
        return e.map(
          (i) => (
            i[Go] || Ko.rebuild(i),
            (i = i.proxyOf),
            i.parent && i.parent.removeChild(i),
            i[Vo] && Jo(i),
            typeof i.raws.before == "undefined" &&
              t &&
              typeof t.raws.before != "undefined" &&
              (i.raws.before = t.raws.before.replace(/\S/g, "")),
            (i.parent = this.proxyOf),
            i
          ),
        );
      }
      prepend(...e) {
        e = e.reverse();
        for (let t of e) {
          let r = this.normalize(t, this.first, "prepend").reverse();
          for (let i of r) this.proxyOf.nodes.unshift(i);
          for (let i in this.indexes) this.indexes[i] = this.indexes[i] + r.length;
        }
        return this.markDirty(), this;
      }
      push(e) {
        return (e.parent = this), this.proxyOf.nodes.push(e), this;
      }
      removeAll() {
        for (let e of this.proxyOf.nodes) e.parent = void 0;
        return (this.proxyOf.nodes = []), this.markDirty(), this;
      }
      removeChild(e) {
        (e = this.index(e)), (this.proxyOf.nodes[e].parent = void 0), this.proxyOf.nodes.splice(e, 1);
        let t;
        for (let r in this.indexes) (t = this.indexes[r]), t >= e && (this.indexes[r] = t - 1);
        return this.markDirty(), this;
      }
      replaceValues(e, t, r) {
        return (
          r || ((r = t), (t = {})),
          this.walkDecls((i) => {
            (t.props && !t.props.includes(i.prop)) ||
              (t.fast && !i.value.includes(t.fast)) ||
              (i.value = i.value.replace(e, r));
          }),
          this.markDirty(),
          this
        );
      }
      some(e) {
        return this.nodes.some(e);
      }
      walk(e) {
        return this.each((t, r) => {
          let i;
          try {
            i = e(t, r);
          } catch (o) {
            throw t.addToError(o);
          }
          return i !== !1 && t.walk && (i = t.walk(e)), i;
        });
      }
      walkAtRules(e, t) {
        return t
          ? e instanceof RegExp
            ? this.walk((r, i) => {
                if (r.type === "atrule" && e.test(r.name)) return t(r, i);
              })
            : this.walk((r, i) => {
                if (r.type === "atrule" && r.name === e) return t(r, i);
              })
          : ((t = e),
            this.walk((r, i) => {
              if (r.type === "atrule") return t(r, i);
            }));
      }
      walkComments(e) {
        return this.walk((t, r) => {
          if (t.type === "comment") return e(t, r);
        });
      }
      walkDecls(e, t) {
        return t
          ? e instanceof RegExp
            ? this.walk((r, i) => {
                if (r.type === "decl" && e.test(r.prop)) return t(r, i);
              })
            : this.walk((r, i) => {
                if (r.type === "decl" && r.prop === e) return t(r, i);
              })
          : ((t = e),
            this.walk((r, i) => {
              if (r.type === "decl") return t(r, i);
            }));
      }
      walkRules(e, t) {
        return t
          ? e instanceof RegExp
            ? this.walk((r, i) => {
                if (r.type === "rule" && e.test(r.selector)) return t(r, i);
              })
            : this.walk((r, i) => {
                if (r.type === "rule" && r.selector === e) return t(r, i);
              })
          : ((t = e),
            this.walk((r, i) => {
              if (r.type === "rule") return t(r, i);
            }));
      }
      get first() {
        if (this.proxyOf.nodes) return this.proxyOf.nodes[0];
      }
      get last() {
        if (this.proxyOf.nodes) return this.proxyOf.nodes[this.proxyOf.nodes.length - 1];
      }
    };
    be.registerParse = (s) => {
      Ho = s;
    };
    be.registerRule = (s) => {
      ei = s;
    };
    be.registerAtRule = (s) => {
      ti = s;
    };
    be.registerRoot = (s) => {
      Zo = s;
    };
    var ke = be;
    be.default = be;
    be.rebuild = (s) => {
      s.type === "atrule"
        ? Object.setPrototypeOf(s, ti.prototype)
        : s.type === "rule"
        ? Object.setPrototypeOf(s, ei.prototype)
        : s.type === "decl"
        ? Object.setPrototypeOf(s, jo.prototype)
        : s.type === "comment"
        ? Object.setPrototypeOf(s, Yo.prototype)
        : s.type === "root" && Object.setPrototypeOf(s, Zo.prototype),
        (s[Go] = !0),
        s.nodes &&
          s.nodes.forEach((e) => {
            be.rebuild(e);
          });
    };
    let Sh = ke,
      Qo,
      qo,
      yt = class extends Sh {
        constructor(e) {
          super(R({ type: "document" }, e)), this.nodes || (this.nodes = []);
        }
        toResult(e = {}) {
          return new Qo(new qo(), this, e).stringify();
        }
      };
    yt.registerLazyResult = (s) => {
      Qo = s;
    };
    yt.registerProcessor = (s) => {
      qo = s;
    };
    var ri = yt;
    yt.default = yt;
    let Ms = class {
      constructor(e, t = {}) {
        if (((this.type = "warning"), (this.text = e), t.node && t.node.source)) {
          let r = t.node.rangeBy(t);
          (this.line = r.start.line),
            (this.column = r.start.column),
            (this.endLine = r.end.line),
            (this.endColumn = r.end.column);
        }
        for (let r in t) this[r] = t[r];
      }
      toString() {
        return this.node
          ? this.node.error(this.text, {
              index: this.index,
              plugin: this.plugin,
              word: this.word,
            }).message
          : this.plugin
          ? this.plugin + ": " + this.text
          : this.text;
      }
    };
    var ea = Ms;
    Ms.default = Ms;
    let vh = ea,
      Rs = class {
        constructor(e, t, r) {
          (this.processor = e),
            (this.messages = []),
            (this.root = t),
            (this.opts = r),
            (this.css = void 0),
            (this.map = void 0);
        }
        toString() {
          return this.css;
        }
        warn(e, t = {}) {
          t.plugin || (this.lastPlugin && this.lastPlugin.postcssPlugin && (t.plugin = this.lastPlugin.postcssPlugin));
          let r = new vh(e, t);
          return this.messages.push(r), r;
        }
        warnings() {
          return this.messages.filter((e) => e.type === "warning");
        }
        get content() {
          return this.css;
        }
      };
    var si = Rs;
    Rs.default = Rs;
    const Xr = 39,
      pn = 34,
      Vt = 92,
      mn = 47,
      Gt = 10,
      nt = 32,
      jt = 12,
      Yt = 9,
      Ht = 13,
      Ch = 91,
      Eh = 93,
      Ih = 40,
      xh = 41,
      Mh = 123,
      Rh = 125,
      Nh = 59,
      Ah = 42,
      Oh = 58,
      Dh = 64,
      Zt = /[\t\n\f\r "#'()/;[\\\]{}]/g,
      Xt = /[\t\n\f\r !"#'():;@[\\\]{}]|\/(?=\*)/g,
      Th = /.[\r\n"'(/\\]/,
      gn = /[\da-f]/i;
    var _h = function (e, t = {}) {
      let r = e.css.valueOf(),
        i = t.ignoreErrors,
        o,
        n,
        a,
        l,
        u,
        c,
        h,
        f,
        p,
        g,
        m = r.length,
        d = 0,
        y = [],
        S = [];
      function w() {
        return d;
      }
      function v(D) {
        throw e.error("Unclosed " + D, d);
      }
      function x() {
        return S.length === 0 && d >= m;
      }
      function N(D) {
        if (S.length) return S.pop();
        if (d >= m) return;
        let J = D ? D.ignoreUnclosed : !1;
        switch (((o = r.charCodeAt(d)), o)) {
          case Gt:
          case nt:
          case Yt:
          case Ht:
          case jt: {
            n = d;
            do (n += 1), (o = r.charCodeAt(n));
            while (o === nt || o === Gt || o === Yt || o === Ht || o === jt);
            (g = ["space", r.slice(d, n)]), (d = n - 1);
            break;
          }
          case Ch:
          case Eh:
          case Mh:
          case Rh:
          case Oh:
          case Nh:
          case xh: {
            let K = String.fromCharCode(o);
            g = [K, K, d];
            break;
          }
          case Ih: {
            if (
              ((f = y.length ? y.pop()[1] : ""),
              (p = r.charCodeAt(d + 1)),
              f === "url" && p !== Xr && p !== pn && p !== nt && p !== Gt && p !== Yt && p !== jt && p !== Ht)
            ) {
              n = d;
              do {
                if (((c = !1), (n = r.indexOf(")", n + 1)), n === -1))
                  if (i || J) {
                    n = d;
                    break;
                  } else v("bracket");
                for (h = n; r.charCodeAt(h - 1) === Vt; ) (h -= 1), (c = !c);
              } while (c);
              (g = ["brackets", r.slice(d, n + 1), d, n]), (d = n);
            } else
              (n = r.indexOf(")", d + 1)),
                (l = r.slice(d, n + 1)),
                n === -1 || Th.test(l) ? (g = ["(", "(", d]) : ((g = ["brackets", l, d, n]), (d = n));
            break;
          }
          case Xr:
          case pn: {
            (a = o === Xr ? "'" : '"'), (n = d);
            do {
              if (((c = !1), (n = r.indexOf(a, n + 1)), n === -1))
                if (i || J) {
                  n = d + 1;
                  break;
                } else v("string");
              for (h = n; r.charCodeAt(h - 1) === Vt; ) (h -= 1), (c = !c);
            } while (c);
            (g = ["string", r.slice(d, n + 1), d, n]), (d = n);
            break;
          }
          case Dh: {
            (Zt.lastIndex = d + 1),
              Zt.test(r),
              Zt.lastIndex === 0 ? (n = r.length - 1) : (n = Zt.lastIndex - 2),
              (g = ["at-word", r.slice(d, n + 1), d, n]),
              (d = n);
            break;
          }
          case Vt: {
            for (n = d, u = !0; r.charCodeAt(n + 1) === Vt; ) (n += 1), (u = !u);
            if (
              ((o = r.charCodeAt(n + 1)),
              u &&
                o !== mn &&
                o !== nt &&
                o !== Gt &&
                o !== Yt &&
                o !== Ht &&
                o !== jt &&
                ((n += 1), gn.test(r.charAt(n))))
            ) {
              for (; gn.test(r.charAt(n + 1)); ) n += 1;
              r.charCodeAt(n + 1) === nt && (n += 1);
            }
            (g = ["word", r.slice(d, n + 1), d, n]), (d = n);
            break;
          }
          default: {
            o === mn && r.charCodeAt(d + 1) === Ah
              ? ((n = r.indexOf("*/", d + 2) + 1),
                n === 0 && (i || J ? (n = r.length) : v("comment")),
                (g = ["comment", r.slice(d, n + 1), d, n]),
                (d = n))
              : ((Xt.lastIndex = d + 1),
                Xt.test(r),
                Xt.lastIndex === 0 ? (n = r.length - 1) : (n = Xt.lastIndex - 2),
                (g = ["word", r.slice(d, n + 1), d, n]),
                y.push(g),
                (d = n));
            break;
          }
        }
        return d++, g;
      }
      function z(D) {
        S.push(D);
      }
      return { back: z, endOfFile: x, nextToken: N, position: w };
    };
    let ta = ke,
      gr = class extends ta {
        constructor(e) {
          super(e), (this.type = "atrule");
        }
        append(...e) {
          return this.proxyOf.nodes || (this.nodes = []), super.append(...e);
        }
        prepend(...e) {
          return this.proxyOf.nodes || (this.nodes = []), super.prepend(...e);
        }
      };
    var ii = gr;
    gr.default = gr;
    ta.registerAtRule(gr);
    let ra = ke,
      sa,
      ia,
      Ke = class extends ra {
        constructor(e) {
          super(e), (this.type = "root"), this.nodes || (this.nodes = []);
        }
        normalize(e, t, r) {
          let i = super.normalize(e);
          if (t) {
            if (r === "prepend")
              this.nodes.length > 1 ? (t.raws.before = this.nodes[1].raws.before) : delete t.raws.before;
            else if (this.first !== t) for (let o of i) o.raws.before = t.raws.before;
          }
          return i;
        }
        removeChild(e, t) {
          let r = this.index(e);
          return (
            !t && r === 0 && this.nodes.length > 1 && (this.nodes[1].raws.before = this.nodes[r].raws.before),
            super.removeChild(e)
          );
        }
        toResult(e = {}) {
          return new sa(new ia(), this, e).stringify();
        }
      };
    Ke.registerLazyResult = (s) => {
      sa = s;
    };
    Ke.registerProcessor = (s) => {
      ia = s;
    };
    var xt = Ke;
    Ke.default = Ke;
    ra.registerRoot(Ke);
    let wt = {
      comma(s) {
        return wt.split(s, [","], !0);
      },
      space(s) {
        let e = [
          " ",
          `
`,
          "	",
        ];
        return wt.split(s, e);
      },
      split(s, e, t) {
        let r = [],
          i = "",
          o = !1,
          n = 0,
          a = !1,
          l = "",
          u = !1;
        for (let c of s)
          u
            ? (u = !1)
            : c === "\\"
            ? (u = !0)
            : a
            ? c === l && (a = !1)
            : c === '"' || c === "'"
            ? ((a = !0), (l = c))
            : c === "("
            ? (n += 1)
            : c === ")"
            ? n > 0 && (n -= 1)
            : n === 0 && e.includes(c) && (o = !0),
            o ? (i !== "" && r.push(i.trim()), (i = ""), (o = !1)) : (i += c);
        return (t || i !== "") && r.push(i.trim()), r;
      },
    };
    var na = wt;
    wt.default = wt;
    let oa = ke,
      kh = na,
      yr = class extends oa {
        constructor(e) {
          super(e), (this.type = "rule"), this.nodes || (this.nodes = []);
        }
        get selectors() {
          return kh.comma(this.selector);
        }
        set selectors(e) {
          let t = this.selector ? this.selector.match(/,\s*/) : null,
            r = t ? t[0] : "," + this.raw("between", "beforeOpen");
          this.selector = e.join(r);
        }
      };
    var ni = yr;
    yr.default = yr;
    oa.registerRule(yr);
    let $h = Tr,
      Ph = _h,
      Lh = kr,
      Fh = ii,
      Bh = xt,
      yn = ni;
    const wn = { empty: !0, space: !0 };
    function Uh(s) {
      for (let e = s.length - 1; e >= 0; e--) {
        let t = s[e],
          r = t[3] || t[2];
        if (r) return r;
      }
    }
    let Wh = class {
      constructor(e) {
        (this.input = e),
          (this.root = new Bh()),
          (this.current = this.root),
          (this.spaces = ""),
          (this.semicolon = !1),
          this.createTokenizer(),
          (this.root.source = {
            input: e,
            start: { column: 1, line: 1, offset: 0 },
          });
      }
      atrule(e) {
        let t = new Fh();
        (t.name = e[1].slice(1)), t.name === "" && this.unnamedAtrule(t, e), this.init(t, e[2]);
        let r,
          i,
          o,
          n = !1,
          a = !1,
          l = [],
          u = [];
        for (; !this.tokenizer.endOfFile(); ) {
          if (
            ((e = this.tokenizer.nextToken()),
            (r = e[0]),
            r === "(" || r === "["
              ? u.push(r === "(" ? ")" : "]")
              : r === "{" && u.length > 0
              ? u.push("}")
              : r === u[u.length - 1] && u.pop(),
            u.length === 0)
          )
            if (r === ";") {
              (t.source.end = this.getPosition(e[2])), t.source.end.offset++, (this.semicolon = !0);
              break;
            } else if (r === "{") {
              a = !0;
              break;
            } else if (r === "}") {
              if (l.length > 0) {
                for (o = l.length - 1, i = l[o]; i && i[0] === "space"; ) i = l[--o];
                i && ((t.source.end = this.getPosition(i[3] || i[2])), t.source.end.offset++);
              }
              this.end(e);
              break;
            } else l.push(e);
          else l.push(e);
          if (this.tokenizer.endOfFile()) {
            n = !0;
            break;
          }
        }
        (t.raws.between = this.spacesAndCommentsFromEnd(l)),
          l.length
            ? ((t.raws.afterName = this.spacesAndCommentsFromStart(l)),
              this.raw(t, "params", l),
              n &&
                ((e = l[l.length - 1]),
                (t.source.end = this.getPosition(e[3] || e[2])),
                t.source.end.offset++,
                (this.spaces = t.raws.between),
                (t.raws.between = "")))
            : ((t.raws.afterName = ""), (t.params = "")),
          a && ((t.nodes = []), (this.current = t));
      }
      checkMissedSemicolon(e) {
        let t = this.colon(e);
        if (t === !1) return;
        let r = 0,
          i;
        for (let o = t - 1; o >= 0 && ((i = e[o]), !(i[0] !== "space" && ((r += 1), r === 2))); o--);
        throw this.input.error("Missed semicolon", i[0] === "word" ? i[3] + 1 : i[2]);
      }
      colon(e) {
        let t = 0,
          r,
          i,
          o;
        for (let [n, a] of e.entries()) {
          if (((r = a), (i = r[0]), i === "(" && (t += 1), i === ")" && (t -= 1), t === 0 && i === ":"))
            if (!o) this.doubleColon(r);
            else {
              if (o[0] === "word" && o[1] === "progid") continue;
              return n;
            }
          o = r;
        }
        return !1;
      }
      comment(e) {
        let t = new Lh();
        this.init(t, e[2]), (t.source.end = this.getPosition(e[3] || e[2])), t.source.end.offset++;
        let r = e[1].slice(2, -2);
        if (/^\s*$/.test(r)) (t.text = ""), (t.raws.left = r), (t.raws.right = "");
        else {
          let i = r.match(/^(\s*)([^]*\S)(\s*)$/);
          (t.text = i[2]), (t.raws.left = i[1]), (t.raws.right = i[3]);
        }
      }
      createTokenizer() {
        this.tokenizer = Ph(this.input);
      }
      decl(e, t) {
        let r = new $h();
        this.init(r, e[0][2]);
        let i = e[e.length - 1];
        for (
          i[0] === ";" && ((this.semicolon = !0), e.pop()),
            r.source.end = this.getPosition(i[3] || i[2] || Uh(e)),
            r.source.end.offset++;
          e[0][0] !== "word";

        )
          e.length === 1 && this.unknownWord(e), (r.raws.before += e.shift()[1]);
        for (r.source.start = this.getPosition(e[0][2]), r.prop = ""; e.length; ) {
          let u = e[0][0];
          if (u === ":" || u === "space" || u === "comment") break;
          r.prop += e.shift()[1];
        }
        r.raws.between = "";
        let o;
        for (; e.length; )
          if (((o = e.shift()), o[0] === ":")) {
            r.raws.between += o[1];
            break;
          } else o[0] === "word" && /\w/.test(o[1]) && this.unknownWord([o]), (r.raws.between += o[1]);
        (r.prop[0] === "_" || r.prop[0] === "*") && ((r.raws.before += r.prop[0]), (r.prop = r.prop.slice(1)));
        let n = [],
          a;
        for (; e.length && ((a = e[0][0]), !(a !== "space" && a !== "comment")); ) n.push(e.shift());
        this.precheckMissedSemicolon(e);
        for (let u = e.length - 1; u >= 0; u--) {
          if (((o = e[u]), o[1].toLowerCase() === "!important")) {
            r.important = !0;
            let c = this.stringFrom(e, u);
            (c = this.spacesFromEnd(e) + c), c !== " !important" && (r.raws.important = c);
            break;
          } else if (o[1].toLowerCase() === "important") {
            let c = e.slice(0),
              h = "";
            for (let f = u; f > 0; f--) {
              let p = c[f][0];
              if (h.trim().indexOf("!") === 0 && p !== "space") break;
              h = c.pop()[1] + h;
            }
            h.trim().indexOf("!") === 0 && ((r.important = !0), (r.raws.important = h), (e = c));
          }
          if (o[0] !== "space" && o[0] !== "comment") break;
        }
        e.some((u) => u[0] !== "space" && u[0] !== "comment") &&
          ((r.raws.between += n.map((u) => u[1]).join("")), (n = [])),
          this.raw(r, "value", n.concat(e), t),
          r.value.includes(":") && !t && this.checkMissedSemicolon(e);
      }
      doubleColon(e) {
        throw this.input.error("Double colon", { offset: e[2] }, { offset: e[2] + e[1].length });
      }
      emptyRule(e) {
        let t = new yn();
        this.init(t, e[2]), (t.selector = ""), (t.raws.between = ""), (this.current = t);
      }
      end(e) {
        this.current.nodes && this.current.nodes.length && (this.current.raws.semicolon = this.semicolon),
          (this.semicolon = !1),
          (this.current.raws.after = (this.current.raws.after || "") + this.spaces),
          (this.spaces = ""),
          this.current.parent
            ? ((this.current.source.end = this.getPosition(e[2])),
              this.current.source.end.offset++,
              (this.current = this.current.parent))
            : this.unexpectedClose(e);
      }
      endFile() {
        this.current.parent && this.unclosedBlock(),
          this.current.nodes && this.current.nodes.length && (this.current.raws.semicolon = this.semicolon),
          (this.current.raws.after = (this.current.raws.after || "") + this.spaces),
          (this.root.source.end = this.getPosition(this.tokenizer.position()));
      }
      freeSemicolon(e) {
        if (((this.spaces += e[1]), this.current.nodes)) {
          let t = this.current.nodes[this.current.nodes.length - 1];
          t && t.type === "rule" && !t.raws.ownSemicolon && ((t.raws.ownSemicolon = this.spaces), (this.spaces = ""));
        }
      }
      getPosition(e) {
        let t = this.input.fromOffset(e);
        return { column: t.col, line: t.line, offset: e };
      }
      init(e, t) {
        this.current.push(e),
          (e.source = { input: this.input, start: this.getPosition(t) }),
          (e.raws.before = this.spaces),
          (this.spaces = ""),
          e.type !== "comment" && (this.semicolon = !1);
      }
      other(e) {
        let t = !1,
          r = null,
          i = !1,
          o = null,
          n = [],
          a = e[1].startsWith("--"),
          l = [],
          u = e;
        for (; u; ) {
          if (((r = u[0]), l.push(u), r === "(" || r === "[")) o || (o = u), n.push(r === "(" ? ")" : "]");
          else if (a && i && r === "{") o || (o = u), n.push("}");
          else if (n.length === 0)
            if (r === ";")
              if (i) {
                this.decl(l, a);
                return;
              } else break;
            else if (r === "{") {
              this.rule(l);
              return;
            } else if (r === "}") {
              this.tokenizer.back(l.pop()), (t = !0);
              break;
            } else r === ":" && (i = !0);
          else r === n[n.length - 1] && (n.pop(), n.length === 0 && (o = null));
          u = this.tokenizer.nextToken();
        }
        if ((this.tokenizer.endOfFile() && (t = !0), n.length > 0 && this.unclosedBracket(o), t && i)) {
          if (!a)
            for (; l.length && ((u = l[l.length - 1][0]), !(u !== "space" && u !== "comment")); )
              this.tokenizer.back(l.pop());
          this.decl(l, a);
        } else this.unknownWord(l);
      }
      parse() {
        let e;
        for (; !this.tokenizer.endOfFile(); )
          switch (((e = this.tokenizer.nextToken()), e[0])) {
            case "space":
              this.spaces += e[1];
              break;
            case ";":
              this.freeSemicolon(e);
              break;
            case "}":
              this.end(e);
              break;
            case "comment":
              this.comment(e);
              break;
            case "at-word":
              this.atrule(e);
              break;
            case "{":
              this.emptyRule(e);
              break;
            default:
              this.other(e);
              break;
          }
        this.endFile();
      }
      precheckMissedSemicolon() {}
      raw(e, t, r, i) {
        let o,
          n,
          a = r.length,
          l = "",
          u = !0,
          c,
          h;
        for (let f = 0; f < a; f += 1)
          (o = r[f]),
            (n = o[0]),
            n === "space" && f === a - 1 && !i
              ? (u = !1)
              : n === "comment"
              ? ((h = r[f - 1] ? r[f - 1][0] : "empty"),
                (c = r[f + 1] ? r[f + 1][0] : "empty"),
                !wn[h] && !wn[c] ? (l.slice(-1) === "," ? (u = !1) : (l += o[1])) : (u = !1))
              : (l += o[1]);
        if (!u) {
          let f = r.reduce((p, g) => p + g[1], "");
          e.raws[t] = { raw: f, value: l };
        }
        e[t] = l;
      }
      rule(e) {
        e.pop();
        let t = new yn();
        this.init(t, e[0][2]),
          (t.raws.between = this.spacesAndCommentsFromEnd(e)),
          this.raw(t, "selector", e),
          (this.current = t);
      }
      spacesAndCommentsFromEnd(e) {
        let t,
          r = "";
        for (; e.length && ((t = e[e.length - 1][0]), !(t !== "space" && t !== "comment")); ) r = e.pop()[1] + r;
        return r;
      }
      spacesAndCommentsFromStart(e) {
        let t,
          r = "";
        for (; e.length && ((t = e[0][0]), !(t !== "space" && t !== "comment")); ) r += e.shift()[1];
        return r;
      }
      spacesFromEnd(e) {
        let t,
          r = "";
        for (; e.length && ((t = e[e.length - 1][0]), t === "space"); ) r = e.pop()[1] + r;
        return r;
      }
      stringFrom(e, t) {
        let r = "";
        for (let i = t; i < e.length; i++) r += e[i][1];
        return e.splice(t, e.length - t), r;
      }
      unclosedBlock() {
        let e = this.current.source.start;
        throw this.input.error("Unclosed block", e.line, e.column);
      }
      unclosedBracket(e) {
        throw this.input.error("Unclosed bracket", { offset: e[2] }, { offset: e[2] + 1 });
      }
      unexpectedClose(e) {
        throw this.input.error("Unexpected }", { offset: e[2] }, { offset: e[2] + 1 });
      }
      unknownWord(e) {
        throw this.input.error("Unknown word", { offset: e[0][2] }, { offset: e[0][2] + e[0][1].length });
      }
      unnamedAtrule(e, t) {
        throw this.input.error("At-rule without name", { offset: t[2] }, { offset: t[2] + t[1].length });
      }
    };
    var zh = Wh;
    let Vh = ke,
      Gh = zh,
      jh = _r;
    function wr(s, e) {
      let t = new jh(s, e),
        r = new Gh(t);
      try {
        r.parse();
      } catch (i) {
        throw i;
      }
      return r.root;
    }
    var oi = wr;
    wr.default = wr;
    Vh.registerParse(wr);
    let { isClean: me, my: Yh } = It,
      Hh = zo,
      Zh = Or,
      Xh = ke,
      Jh = ri;
    let bn = si,
      Kh = oi,
      Qh = xt;
    const qh = {
        atrule: "AtRule",
        comment: "Comment",
        decl: "Declaration",
        document: "Document",
        root: "Root",
        rule: "Rule",
      },
      ef = {
        AtRule: !0,
        AtRuleExit: !0,
        Comment: !0,
        CommentExit: !0,
        Declaration: !0,
        DeclarationExit: !0,
        Document: !0,
        DocumentExit: !0,
        Once: !0,
        OnceExit: !0,
        postcssPlugin: !0,
        prepare: !0,
        Root: !0,
        RootExit: !0,
        Rule: !0,
        RuleExit: !0,
      },
      tf = { Once: !0, postcssPlugin: !0, prepare: !0 },
      Qe = 0;
    function ot(s) {
      return typeof s == "object" && typeof s.then == "function";
    }
    function aa(s) {
      let e = !1,
        t = qh[s.type];
      return (
        s.type === "decl" ? (e = s.prop.toLowerCase()) : s.type === "atrule" && (e = s.name.toLowerCase()),
        e && s.append
          ? [t, t + "-" + e, Qe, t + "Exit", t + "Exit-" + e]
          : e
          ? [t, t + "-" + e, t + "Exit", t + "Exit-" + e]
          : s.append
          ? [t, Qe, t + "Exit"]
          : [t, t + "Exit"]
      );
    }
    function Sn(s) {
      let e;
      return (
        s.type === "document"
          ? (e = ["Document", Qe, "DocumentExit"])
          : s.type === "root"
          ? (e = ["Root", Qe, "RootExit"])
          : (e = aa(s)),
        {
          eventIndex: 0,
          events: e,
          iterator: 0,
          node: s,
          visitorIndex: 0,
          visitors: [],
        }
      );
    }
    function Ns(s) {
      return (s[me] = !1), s.nodes && s.nodes.forEach((e) => Ns(e)), s;
    }
    let As = {},
      qe = class la {
        constructor(e, t, r) {
          (this.stringified = !1), (this.processed = !1);
          let i;
          if (typeof t == "object" && t !== null && (t.type === "root" || t.type === "document")) i = Ns(t);
          else if (t instanceof la || t instanceof bn)
            (i = Ns(t.root)),
              t.map &&
                (typeof r.map == "undefined" && (r.map = {}),
                r.map.inline || (r.map.inline = !1),
                (r.map.prev = t.map));
          else {
            let o = Kh;
            r.syntax && (o = r.syntax.parse), r.parser && (o = r.parser), o.parse && (o = o.parse);
            try {
              i = o(t, r);
            } catch (n) {
              (this.processed = !0), (this.error = n);
            }
            i && !i[Yh] && Xh.rebuild(i);
          }
          (this.result = new bn(e, i, r)),
            (this.helpers = Q(R({}, As), { postcss: As, result: this.result })),
            (this.plugins = this.processor.plugins.map((o) =>
              typeof o == "object" && o.prepare ? R(R({}, o), o.prepare(this.result)) : o,
            ));
        }
        async() {
          return this.error
            ? Promise.reject(this.error)
            : this.processed
            ? Promise.resolve(this.result)
            : (this.processing || (this.processing = this.runAsync()), this.processing);
        }
        catch(e) {
          return this.async().catch(e);
        }
        finally(e) {
          return this.async().then(e, e);
        }
        getAsyncError() {
          throw new Error("Use process(css).then(cb) to work with async plugins");
        }
        handleError(e, t) {
          let r = this.result.lastPlugin;
          try {
            t && t.addToError(e),
              (this.error = e),
              e.name === "CssSyntaxError" && !e.plugin
                ? ((e.plugin = r.postcssPlugin), e.setMessage())
                : r.postcssVersion;
          } catch (i) {
            console && console.error && console.error(i);
          }
          return e;
        }
        prepareVisitors() {
          this.listeners = {};
          let e = (t, r, i) => {
            this.listeners[r] || (this.listeners[r] = []), this.listeners[r].push([t, i]);
          };
          for (let t of this.plugins)
            if (typeof t == "object")
              for (let r in t) {
                if (!ef[r] && /^[A-Z]/.test(r))
                  throw new Error(
                    `Unknown event ${r} in ${t.postcssPlugin}. Try to update PostCSS (${this.processor.version} now).`,
                  );
                if (!tf[r])
                  if (typeof t[r] == "object")
                    for (let i in t[r]) i === "*" ? e(t, r, t[r][i]) : e(t, r + "-" + i.toLowerCase(), t[r][i]);
                  else typeof t[r] == "function" && e(t, r, t[r]);
              }
          this.hasListener = Object.keys(this.listeners).length > 0;
        }
        async runAsync() {
          this.plugin = 0;
          for (let e = 0; e < this.plugins.length; e++) {
            let t = this.plugins[e],
              r = this.runOnRoot(t);
            if (ot(r))
              try {
                await r;
              } catch (i) {
                throw this.handleError(i);
              }
          }
          if ((this.prepareVisitors(), this.hasListener)) {
            let e = this.result.root;
            for (; !e[me]; ) {
              e[me] = !0;
              let t = [Sn(e)];
              for (; t.length > 0; ) {
                let r = this.visitTick(t);
                if (ot(r))
                  try {
                    await r;
                  } catch (i) {
                    let o = t[t.length - 1].node;
                    throw this.handleError(i, o);
                  }
              }
            }
            if (this.listeners.OnceExit)
              for (let [t, r] of this.listeners.OnceExit) {
                this.result.lastPlugin = t;
                try {
                  if (e.type === "document") {
                    let i = e.nodes.map((o) => r(o, this.helpers));
                    await Promise.all(i);
                  } else await r(e, this.helpers);
                } catch (i) {
                  throw this.handleError(i);
                }
              }
          }
          return (this.processed = !0), this.stringify();
        }
        runOnRoot(e) {
          this.result.lastPlugin = e;
          try {
            if (typeof e == "object" && e.Once) {
              if (this.result.root.type === "document") {
                let t = this.result.root.nodes.map((r) => e.Once(r, this.helpers));
                return ot(t[0]) ? Promise.all(t) : t;
              }
              return e.Once(this.result.root, this.helpers);
            } else if (typeof e == "function") return e(this.result.root, this.result);
          } catch (t) {
            throw this.handleError(t);
          }
        }
        stringify() {
          if (this.error) throw this.error;
          if (this.stringified) return this.result;
          (this.stringified = !0), this.sync();
          let e = this.result.opts,
            t = Zh;
          e.syntax && (t = e.syntax.stringify), e.stringifier && (t = e.stringifier), t.stringify && (t = t.stringify);
          let i = new Hh(t, this.result.root, this.result.opts).generate();
          return (this.result.css = i[0]), (this.result.map = i[1]), this.result;
        }
        sync() {
          if (this.error) throw this.error;
          if (this.processed) return this.result;
          if (((this.processed = !0), this.processing)) throw this.getAsyncError();
          for (let e of this.plugins) {
            let t = this.runOnRoot(e);
            if (ot(t)) throw this.getAsyncError();
          }
          if ((this.prepareVisitors(), this.hasListener)) {
            let e = this.result.root;
            for (; !e[me]; ) (e[me] = !0), this.walkSync(e);
            if (this.listeners.OnceExit)
              if (e.type === "document") for (let t of e.nodes) this.visitSync(this.listeners.OnceExit, t);
              else this.visitSync(this.listeners.OnceExit, e);
          }
          return this.result;
        }
        then(e, t) {
          return this.async().then(e, t);
        }
        toString() {
          return this.css;
        }
        visitSync(e, t) {
          for (let [r, i] of e) {
            this.result.lastPlugin = r;
            let o;
            try {
              o = i(t, this.helpers);
            } catch (n) {
              throw this.handleError(n, t.proxyOf);
            }
            if (t.type !== "root" && t.type !== "document" && !t.parent) return !0;
            if (ot(o)) throw this.getAsyncError();
          }
        }
        visitTick(e) {
          let t = e[e.length - 1],
            { node: r, visitors: i } = t;
          if (r.type !== "root" && r.type !== "document" && !r.parent) {
            e.pop();
            return;
          }
          if (i.length > 0 && t.visitorIndex < i.length) {
            let [n, a] = i[t.visitorIndex];
            (t.visitorIndex += 1),
              t.visitorIndex === i.length && ((t.visitors = []), (t.visitorIndex = 0)),
              (this.result.lastPlugin = n);
            try {
              return a(r.toProxy(), this.helpers);
            } catch (l) {
              throw this.handleError(l, r);
            }
          }
          if (t.iterator !== 0) {
            let n = t.iterator,
              a;
            for (; (a = r.nodes[r.indexes[n]]); )
              if (((r.indexes[n] += 1), !a[me])) {
                (a[me] = !0), e.push(Sn(a));
                return;
              }
            (t.iterator = 0), delete r.indexes[n];
          }
          let o = t.events;
          for (; t.eventIndex < o.length; ) {
            let n = o[t.eventIndex];
            if (((t.eventIndex += 1), n === Qe)) {
              r.nodes && r.nodes.length && ((r[me] = !0), (t.iterator = r.getIterator()));
              return;
            } else if (this.listeners[n]) {
              t.visitors = this.listeners[n];
              return;
            }
          }
          e.pop();
        }
        walkSync(e) {
          e[me] = !0;
          let t = aa(e);
          for (let r of t)
            if (r === Qe)
              e.nodes &&
                e.each((i) => {
                  i[me] || this.walkSync(i);
                });
            else {
              let i = this.listeners[r];
              if (i && this.visitSync(i, e.toProxy())) return;
            }
        }
        warnings() {
          return this.sync().warnings();
        }
        get content() {
          return this.stringify().content;
        }
        get css() {
          return this.stringify().css;
        }
        get map() {
          return this.stringify().map;
        }
        get messages() {
          return this.sync().messages;
        }
        get opts() {
          return this.result.opts;
        }
        get processor() {
          return this.result.processor;
        }
        get root() {
          return this.sync().root;
        }
        get [Symbol.toStringTag]() {
          return "LazyResult";
        }
      };
    qe.registerPostcss = (s) => {
      As = s;
    };
    var ua = qe;
    qe.default = qe;
    Qh.registerLazyResult(qe);
    Jh.registerLazyResult(qe);
    let rf = zo,
      sf = Or;
    let nf = oi;
    const of = si;
    let Os = class {
      constructor(e, t, r) {
        (t = t.toString()),
          (this.stringified = !1),
          (this._processor = e),
          (this._css = t),
          (this._opts = r),
          (this._map = void 0);
        let i,
          o = sf;
        (this.result = new of(this._processor, i, this._opts)), (this.result.css = t);
        let n = this;
        Object.defineProperty(this.result, "root", {
          get() {
            return n.root;
          },
        });
        let a = new rf(o, i, this._opts, t);
        if (a.isMap()) {
          let [l, u] = a.generate();
          l && (this.result.css = l), u && (this.result.map = u);
        } else a.clearAnnotation(), (this.result.css = a.css);
      }
      async() {
        return this.error ? Promise.reject(this.error) : Promise.resolve(this.result);
      }
      catch(e) {
        return this.async().catch(e);
      }
      finally(e) {
        return this.async().then(e, e);
      }
      sync() {
        if (this.error) throw this.error;
        return this.result;
      }
      then(e, t) {
        return this.async().then(e, t);
      }
      toString() {
        return this._css;
      }
      warnings() {
        return [];
      }
      get content() {
        return this.result.css;
      }
      get css() {
        return this.result.css;
      }
      get map() {
        return this.result.map;
      }
      get messages() {
        return [];
      }
      get opts() {
        return this.result.opts;
      }
      get processor() {
        return this.result.processor;
      }
      get root() {
        if (this._root) return this._root;
        let e,
          t = nf;
        try {
          e = t(this._css, this._opts);
        } catch (r) {
          this.error = r;
        }
        if (this.error) throw this.error;
        return (this._root = e), e;
      }
      get [Symbol.toStringTag]() {
        return "NoWorkResult";
      }
    };
    var af = Os;
    Os.default = Os;
    let lf = af,
      uf = ua,
      cf = ri,
      hf = xt,
      bt = class {
        constructor(e = []) {
          (this.version = "8.4.38"), (this.plugins = this.normalize(e));
        }
        normalize(e) {
          let t = [];
          for (let r of e)
            if (
              (r.postcss === !0 ? (r = r()) : r.postcss && (r = r.postcss),
              typeof r == "object" && Array.isArray(r.plugins))
            )
              t = t.concat(r.plugins);
            else if (typeof r == "object" && r.postcssPlugin) t.push(r);
            else if (typeof r == "function") t.push(r);
            else if (!(typeof r == "object" && (r.parse || r.stringify)))
              throw new Error(r + " is not a PostCSS plugin");
          return t;
        }
        process(e, t = {}) {
          return !this.plugins.length && !t.parser && !t.stringifier && !t.syntax
            ? new lf(this, e, t)
            : new uf(this, e, t);
        }
        use(e) {
          return (this.plugins = this.plugins.concat(this.normalize([e]))), this;
        }
      };
    var ff = bt;
    bt.default = bt;
    hf.registerProcessor(bt);
    cf.registerProcessor(bt);
    let df = Tr,
      pf = Lo,
      mf = kr,
      gf = ii,
      yf = _r,
      wf = xt,
      bf = ni;
    function St(s, e) {
      if (Array.isArray(s)) return s.map((n) => St(n));
      let i = s,
        { inputs: t } = i,
        r = Le(i, ["inputs"]);
      if (t) {
        e = [];
        for (let n of t) {
          let a = Q(R({}, n), { __proto__: yf.prototype });
          a.map && (a.map = Q(R({}, a.map), { __proto__: pf.prototype })), e.push(a);
        }
      }
      if ((r.nodes && (r.nodes = s.nodes.map((n) => St(n, e))), r.source)) {
        let o = r.source,
          { inputId: n } = o,
          a = Le(o, ["inputId"]);
        (r.source = a), n != null && (r.source.input = e[n]);
      }
      if (r.type === "root") return new wf(r);
      if (r.type === "decl") return new df(r);
      if (r.type === "rule") return new bf(r);
      if (r.type === "comment") return new mf(r);
      if (r.type === "atrule") return new gf(r);
      throw new Error("Unknown node type: " + s.type);
    }
    var Sf = St;
    St.default = St;
    let vf = qs,
      ca = Tr,
      Cf = ua,
      Ef = ke,
      ai = ff,
      If = Or,
      xf = Sf,
      ha = ri,
      Mf = ea,
      fa = kr,
      da = ii,
      Rf = si,
      Nf = _r,
      Af = oi,
      Of = na,
      pa = ni,
      ma = xt,
      Df = Dr;
    function F(...s) {
      return s.length === 1 && Array.isArray(s[0]) && (s = s[0]), new ai(s);
    }
    F.plugin = function (e, t) {
      let r = !1;
      function i(...n) {
        console &&
          console.warn &&
          !r &&
          ((r = !0),
          console.warn(
            e +
              `: postcss.plugin was deprecated. Migration guide:
https://evilmartians.com/chronicles/postcss-8-plugin-migration`,
          ),
          process.env.LANG &&
            process.env.LANG.startsWith("cn") &&
            console.warn(
              e +
                `: \u91CC\u9762 postcss.plugin \u88AB\u5F03\u7528. \u8FC1\u79FB\u6307\u5357:
https://www.w3ctech.com/topic/2226`,
            ));
        let a = t(...n);
        return (a.postcssPlugin = e), (a.postcssVersion = new ai().version), a;
      }
      let o;
      return (
        Object.defineProperty(i, "postcss", {
          get() {
            return o || (o = i()), o;
          },
        }),
        (i.process = function (n, a, l) {
          return F([i(l)]).process(n, a);
        }),
        i
      );
    };
    F.stringify = If;
    F.parse = Af;
    F.fromJSON = xf;
    F.list = Of;
    F.comment = (s) => new fa(s);
    F.atRule = (s) => new da(s);
    F.decl = (s) => new ca(s);
    F.rule = (s) => new pa(s);
    F.root = (s) => new ma(s);
    F.document = (s) => new ha(s);
    F.CssSyntaxError = vf;
    F.Declaration = ca;
    F.Container = Ef;
    F.Processor = ai;
    F.Document = ha;
    F.Comment = fa;
    F.Warning = Mf;
    F.AtRule = da;
    F.Result = Rf;
    F.Input = Nf;
    F.Rule = pa;
    F.Root = ma;
    F.Node = Df;
    Cf.registerPostcss(F);
    var Tf = F;
    F.default = F;
    const Y = Vc(Tf);
    Y.stringify;
    Y.fromJSON;
    Y.plugin;
    Y.parse;
    Y.list;
    Y.document;
    Y.comment;
    Y.atRule;
    Y.rule;
    Y.decl;
    Y.root;
    Y.CssSyntaxError;
    Y.Declaration;
    Y.Container;
    Y.Processor;
    Y.Document;
    Y.Comment;
    Y.Warning;
    Y.AtRule;
    Y.Result;
    Y.Input;
    Y.Rule;
    Y.Root;
    Y.Node;
    function _f(s) {
      const e = {},
        t = /;(?![^(]*\))/g,
        r = /:(.+)/,
        i = /\/\*.*?\*\//g;
      return (
        s
          .replace(i, "")
          .split(t)
          .forEach(function (o) {
            if (o) {
              const n = o.split(r);
              n.length > 1 && (e[Ds(n[0].trim())] = n[1].trim());
            }
          }),
        e
      );
    }
    function vn(s) {
      const e = [];
      for (const t in s) {
        const r = s[t];
        if (typeof r != "string") continue;
        const i = Lf(t);
        e.push(`${i}: ${r};`);
      }
      return e.join(" ");
    }
    const kf = /-([a-z])/g,
      $f = /^--[a-zA-Z0-9-]+$/,
      Ds = (s) => ($f.test(s) ? s : s.replace(kf, (e, t) => (t ? t.toUpperCase() : ""))),
      Pf = /\B([A-Z])/g,
      Lf = (s) => s.replace(Pf, "-$1").toLowerCase();
    class he {
      constructor(...e) {
        C(this, "parentElement", null),
          C(this, "parentNode", null),
          C(this, "ownerDocument"),
          C(this, "firstChild", null),
          C(this, "lastChild", null),
          C(this, "previousSibling", null),
          C(this, "nextSibling", null),
          C(this, "ELEMENT_NODE", 1),
          C(this, "TEXT_NODE", 3),
          C(this, "nodeType"),
          C(this, "nodeName"),
          C(this, "RRNodeType");
      }
      get childNodes() {
        const e = [];
        let t = this.firstChild;
        for (; t; ) e.push(t), (t = t.nextSibling);
        return e;
      }
      contains(e) {
        if (e instanceof he) {
          if (e.ownerDocument !== this.ownerDocument) return !1;
          if (e === this) return !0;
        } else return !1;
        for (; e.parentNode; ) {
          if (e.parentNode === this) return !0;
          e = e.parentNode;
        }
        return !1;
      }
      appendChild(e) {
        throw new Error(
          "RRDomException: Failed to execute 'appendChild' on 'RRNode': This RRNode type does not support this method.",
        );
      }
      insertBefore(e, t) {
        throw new Error(
          "RRDomException: Failed to execute 'insertBefore' on 'RRNode': This RRNode type does not support this method.",
        );
      }
      removeChild(e) {
        throw new Error(
          "RRDomException: Failed to execute 'removeChild' on 'RRNode': This RRNode type does not support this method.",
        );
      }
      toString() {
        return "RRNode";
      }
    }
    class li extends he {
      constructor(...e) {
        super(e),
          C(this, "nodeType", 9),
          C(this, "nodeName", "#document"),
          C(this, "compatMode", "CSS1Compat"),
          C(this, "RRNodeType", O.Document),
          C(this, "textContent", null),
          (this.ownerDocument = this);
      }
      get documentElement() {
        return this.childNodes.find((e) => e.RRNodeType === O.Element && e.tagName === "HTML") || null;
      }
      get body() {
        var e;
        return (
          ((e = this.documentElement) == null
            ? void 0
            : e.childNodes.find((t) => t.RRNodeType === O.Element && t.tagName === "BODY")) || null
        );
      }
      get head() {
        var e;
        return (
          ((e = this.documentElement) == null
            ? void 0
            : e.childNodes.find((t) => t.RRNodeType === O.Element && t.tagName === "HEAD")) || null
        );
      }
      get implementation() {
        return this;
      }
      get firstElementChild() {
        return this.documentElement;
      }
      appendChild(e) {
        const t = e.RRNodeType;
        if ((t === O.Element || t === O.DocumentType) && this.childNodes.some((i) => i.RRNodeType === t))
          throw new Error(
            `RRDomException: Failed to execute 'appendChild' on 'RRNode': Only one ${
              t === O.Element ? "RRElement" : "RRDoctype"
            } on RRDocument allowed.`,
          );
        const r = ui(this, e);
        return (r.parentElement = null), r;
      }
      insertBefore(e, t) {
        const r = e.RRNodeType;
        if ((r === O.Element || r === O.DocumentType) && this.childNodes.some((o) => o.RRNodeType === r))
          throw new Error(
            `RRDomException: Failed to execute 'insertBefore' on 'RRNode': Only one ${
              r === O.Element ? "RRElement" : "RRDoctype"
            } on RRDocument allowed.`,
          );
        const i = Sa(this, e, t);
        return (i.parentElement = null), i;
      }
      removeChild(e) {
        return va(this, e);
      }
      open() {
        (this.firstChild = null), (this.lastChild = null);
      }
      close() {}
      write(e) {
        let t;
        if (
          (e === '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "">'
            ? (t = "-//W3C//DTD XHTML 1.0 Transitional//EN")
            : e === '<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.0 Transitional//EN" "">' &&
              (t = "-//W3C//DTD HTML 4.0 Transitional//EN"),
          t)
        ) {
          const r = this.createDocumentType("html", t, "");
          this.open(), this.appendChild(r);
        }
      }
      createDocument(e, t, r) {
        return new li();
      }
      createDocumentType(e, t, r) {
        const i = new ga(e, t, r);
        return (i.ownerDocument = this), i;
      }
      createElement(e) {
        const t = new $r(e);
        return (t.ownerDocument = this), t;
      }
      createElementNS(e, t) {
        return this.createElement(t);
      }
      createTextNode(e) {
        const t = new ya(e);
        return (t.ownerDocument = this), t;
      }
      createComment(e) {
        const t = new wa(e);
        return (t.ownerDocument = this), t;
      }
      createCDATASection(e) {
        const t = new ba(e);
        return (t.ownerDocument = this), t;
      }
      toString() {
        return "RRDocument";
      }
    }
    class ga extends he {
      constructor(e, t, r) {
        super(),
          C(this, "nodeType", 10),
          C(this, "RRNodeType", O.DocumentType),
          C(this, "name"),
          C(this, "publicId"),
          C(this, "systemId"),
          C(this, "textContent", null),
          (this.name = e),
          (this.publicId = t),
          (this.systemId = r),
          (this.nodeName = e);
      }
      toString() {
        return "RRDocumentType";
      }
    }
    class $r extends he {
      constructor(e) {
        super(),
          C(this, "nodeType", 1),
          C(this, "RRNodeType", O.Element),
          C(this, "tagName"),
          C(this, "attributes", {}),
          C(this, "shadowRoot", null),
          C(this, "scrollLeft"),
          C(this, "scrollTop"),
          (this.tagName = e.toUpperCase()),
          (this.nodeName = e.toUpperCase());
      }
      get textContent() {
        let e = "";
        return this.childNodes.forEach((t) => (e += t.textContent)), e;
      }
      set textContent(e) {
        (this.firstChild = null), (this.lastChild = null), this.appendChild(this.ownerDocument.createTextNode(e));
      }
      get classList() {
        return new Uf(this.attributes.class, (e) => {
          this.attributes.class = e;
        });
      }
      get id() {
        return this.attributes.id || "";
      }
      get className() {
        return this.attributes.class || "";
      }
      get style() {
        const e = this.attributes.style ? _f(this.attributes.style) : {},
          t = /\B([A-Z])/g;
        return (
          (e.setProperty = (r, i, o) => {
            if (t.test(r)) return;
            const n = Ds(r);
            i ? (e[n] = i) : delete e[n], o === "important" && (e[n] += " !important"), (this.attributes.style = vn(e));
          }),
          (e.removeProperty = (r) => {
            if (t.test(r)) return "";
            const i = Ds(r),
              o = e[i] || "";
            return delete e[i], (this.attributes.style = vn(e)), o;
          }),
          e
        );
      }
      getAttribute(e) {
        return this.attributes[e] === void 0 ? null : this.attributes[e];
      }
      setAttribute(e, t) {
        this.attributes[e] = t;
      }
      setAttributeNS(e, t, r) {
        this.setAttribute(t, r);
      }
      removeAttribute(e) {
        delete this.attributes[e];
      }
      appendChild(e) {
        return ui(this, e);
      }
      insertBefore(e, t) {
        return Sa(this, e, t);
      }
      removeChild(e) {
        return va(this, e);
      }
      attachShadow(e) {
        const t = this.ownerDocument.createElement("SHADOWROOT");
        return (this.shadowRoot = t), t;
      }
      dispatchEvent(e) {
        return !0;
      }
      toString() {
        let e = "";
        for (const t in this.attributes) e += `${t}="${this.attributes[t]}" `;
        return `${this.tagName} ${e}`;
      }
    }
    class Ff extends $r {
      constructor() {
        super(...arguments),
          C(this, "currentTime"),
          C(this, "volume"),
          C(this, "paused"),
          C(this, "muted"),
          C(this, "playbackRate"),
          C(this, "loop");
      }
      attachShadow(e) {
        throw new Error(
          "RRDomException: Failed to execute 'attachShadow' on 'RRElement': This RRElement does not support attachShadow",
        );
      }
      play() {
        this.paused = !1;
      }
      pause() {
        this.paused = !0;
      }
    }
    class Bf extends $r {
      constructor() {
        super(...arguments), C(this, "tagName", "DIALOG"), C(this, "nodeName", "DIALOG");
      }
      get isModal() {
        return this.getAttribute("rr_open_mode") === "modal";
      }
      get open() {
        return this.getAttribute("open") !== null;
      }
      close() {
        this.removeAttribute("open"), this.removeAttribute("rr_open_mode");
      }
      show() {
        this.setAttribute("open", ""), this.setAttribute("rr_open_mode", "non-modal");
      }
      showModal() {
        this.setAttribute("open", ""), this.setAttribute("rr_open_mode", "modal");
      }
    }
    class ya extends he {
      constructor(e) {
        super(),
          C(this, "nodeType", 3),
          C(this, "nodeName", "#text"),
          C(this, "RRNodeType", O.Text),
          C(this, "data"),
          (this.data = e);
      }
      get textContent() {
        return this.data;
      }
      set textContent(e) {
        this.data = e;
      }
      toString() {
        return `RRText text=${JSON.stringify(this.data)}`;
      }
    }
    class wa extends he {
      constructor(e) {
        super(),
          C(this, "nodeType", 8),
          C(this, "nodeName", "#comment"),
          C(this, "RRNodeType", O.Comment),
          C(this, "data"),
          (this.data = e);
      }
      get textContent() {
        return this.data;
      }
      set textContent(e) {
        this.data = e;
      }
      toString() {
        return `RRComment text=${JSON.stringify(this.data)}`;
      }
    }
    class ba extends he {
      constructor(e) {
        super(),
          C(this, "nodeName", "#cdata-section"),
          C(this, "nodeType", 4),
          C(this, "RRNodeType", O.CDATA),
          C(this, "data"),
          (this.data = e);
      }
      get textContent() {
        return this.data;
      }
      set textContent(e) {
        this.data = e;
      }
      toString() {
        return `RRCDATASection data=${JSON.stringify(this.data)}`;
      }
    }
    class Uf {
      constructor(e, t) {
        if (
          (C(this, "onChange"),
          C(this, "classes", []),
          C(this, "add", (...r) => {
            for (const i of r) {
              const o = String(i);
              this.classes.indexOf(o) >= 0 || this.classes.push(o);
            }
            this.onChange && this.onChange(this.classes.join(" "));
          }),
          C(this, "remove", (...r) => {
            (this.classes = this.classes.filter((i) => r.indexOf(i) === -1)),
              this.onChange && this.onChange(this.classes.join(" "));
          }),
          e)
        ) {
          const r = e.trim().split(/\s+/);
          this.classes.push(...r);
        }
        this.onChange = t;
      }
    }
    function ui(s, e) {
      return (
        e.parentNode && e.parentNode.removeChild(e),
        s.lastChild
          ? ((s.lastChild.nextSibling = e), (e.previousSibling = s.lastChild))
          : ((s.firstChild = e), (e.previousSibling = null)),
        (s.lastChild = e),
        (e.nextSibling = null),
        (e.parentNode = s),
        (e.parentElement = s),
        (e.ownerDocument = s.ownerDocument),
        e
      );
    }
    function Sa(s, e, t) {
      if (!t) return ui(s, e);
      if (t.parentNode !== s)
        throw new Error(
          "Failed to execute 'insertBefore' on 'RRNode': The RRNode before which the new node is to be inserted is not a child of this RRNode.",
        );
      return (
        e === t ||
          (e.parentNode && e.parentNode.removeChild(e),
          (e.previousSibling = t.previousSibling),
          (t.previousSibling = e),
          (e.nextSibling = t),
          e.previousSibling ? (e.previousSibling.nextSibling = e) : (s.firstChild = e),
          (e.parentElement = s),
          (e.parentNode = s),
          (e.ownerDocument = s.ownerDocument)),
        e
      );
    }
    function va(s, e) {
      if (e.parentNode !== s)
        throw new Error(
          "Failed to execute 'removeChild' on 'RRNode': The RRNode to be removed is not a child of this RRNode.",
        );
      return (
        e.previousSibling ? (e.previousSibling.nextSibling = e.nextSibling) : (s.firstChild = e.nextSibling),
        e.nextSibling ? (e.nextSibling.previousSibling = e.previousSibling) : (s.lastChild = e.previousSibling),
        (e.previousSibling = null),
        (e.nextSibling = null),
        (e.parentElement = null),
        (e.parentNode = null),
        e
      );
    }
    var oe = ((s) => (
      (s[(s.PLACEHOLDER = 0)] = "PLACEHOLDER"),
      (s[(s.ELEMENT_NODE = 1)] = "ELEMENT_NODE"),
      (s[(s.ATTRIBUTE_NODE = 2)] = "ATTRIBUTE_NODE"),
      (s[(s.TEXT_NODE = 3)] = "TEXT_NODE"),
      (s[(s.CDATA_SECTION_NODE = 4)] = "CDATA_SECTION_NODE"),
      (s[(s.ENTITY_REFERENCE_NODE = 5)] = "ENTITY_REFERENCE_NODE"),
      (s[(s.ENTITY_NODE = 6)] = "ENTITY_NODE"),
      (s[(s.PROCESSING_INSTRUCTION_NODE = 7)] = "PROCESSING_INSTRUCTION_NODE"),
      (s[(s.COMMENT_NODE = 8)] = "COMMENT_NODE"),
      (s[(s.DOCUMENT_NODE = 9)] = "DOCUMENT_NODE"),
      (s[(s.DOCUMENT_TYPE_NODE = 10)] = "DOCUMENT_TYPE_NODE"),
      (s[(s.DOCUMENT_FRAGMENT_NODE = 11)] = "DOCUMENT_FRAGMENT_NODE"),
      s
    ))(oe || {});
    const Ts = {
        svg: "http://www.w3.org/2000/svg",
        "xlink:href": "http://www.w3.org/1999/xlink",
        xmlns: "http://www.w3.org/2000/xmlns/",
      },
      Wf = {
        altglyph: "altGlyph",
        altglyphdef: "altGlyphDef",
        altglyphitem: "altGlyphItem",
        animatecolor: "animateColor",
        animatemotion: "animateMotion",
        animatetransform: "animateTransform",
        clippath: "clipPath",
        feblend: "feBlend",
        fecolormatrix: "feColorMatrix",
        fecomponenttransfer: "feComponentTransfer",
        fecomposite: "feComposite",
        feconvolvematrix: "feConvolveMatrix",
        fediffuselighting: "feDiffuseLighting",
        fedisplacementmap: "feDisplacementMap",
        fedistantlight: "feDistantLight",
        fedropshadow: "feDropShadow",
        feflood: "feFlood",
        fefunca: "feFuncA",
        fefuncb: "feFuncB",
        fefuncg: "feFuncG",
        fefuncr: "feFuncR",
        fegaussianblur: "feGaussianBlur",
        feimage: "feImage",
        femerge: "feMerge",
        femergenode: "feMergeNode",
        femorphology: "feMorphology",
        feoffset: "feOffset",
        fepointlight: "fePointLight",
        fespecularlighting: "feSpecularLighting",
        fespotlight: "feSpotLight",
        fetile: "feTile",
        feturbulence: "feTurbulence",
        foreignobject: "foreignObject",
        glyphref: "glyphRef",
        lineargradient: "linearGradient",
        radialgradient: "radialGradient",
      };
    let ge = null;
    function br(s, e, t, r = e.mirror || e.ownerDocument.mirror) {
      (s = zf(s, e, t, r)), Ca(s, e, t, r), Vf(s, e, t);
    }
    function zf(s, e, t, r) {
      var i;
      if (
        (t.afterAppend &&
          !ge &&
          ((ge = new WeakSet()),
          setTimeout(() => {
            ge = null;
          }, 0)),
        !ci(s, e))
      ) {
        const o = Sr(e, t.mirror, r);
        (i = s.parentNode) == null || i.replaceChild(o, s), (s = o);
      }
      switch (e.RRNodeType) {
        case O.Document: {
          if (!Be(s, e, t.mirror, r)) {
            const o = r.getMeta(e);
            o && (t.mirror.removeNodeFromMap(s), s.close(), s.open(), t.mirror.add(s, o), ge == null || ge.add(s));
          }
          break;
        }
        case O.Element: {
          const o = s,
            n = e;
          switch (n.tagName) {
            case "IFRAME": {
              const a = s.contentDocument;
              if (!a) break;
              br(a, e.contentDocument, t, r);
              break;
            }
          }
          n.shadowRoot && (o.shadowRoot || o.attachShadow({ mode: "open" }), Ca(o.shadowRoot, n.shadowRoot, t, r)),
            Gf(o, n, r);
          break;
        }
      }
      return s;
    }
    function Vf(s, e, t) {
      var r;
      switch (e.RRNodeType) {
        case O.Document: {
          const i = e.scrollData;
          i && t.applyScroll(i, !0);
          break;
        }
        case O.Element: {
          const i = s,
            o = e;
          switch (
            (o.scrollData && t.applyScroll(o.scrollData, !0), o.inputData && t.applyInput(o.inputData), o.tagName)
          ) {
            case "AUDIO":
            case "VIDEO": {
              const n = s,
                a = o;
              a.paused !== void 0 && (a.paused ? n.pause() : n.play()),
                a.muted !== void 0 && (n.muted = a.muted),
                a.volume !== void 0 && (n.volume = a.volume),
                a.currentTime !== void 0 && (n.currentTime = a.currentTime),
                a.playbackRate !== void 0 && (n.playbackRate = a.playbackRate),
                a.loop !== void 0 && (n.loop = a.loop);
              break;
            }
            case "CANVAS": {
              const n = e;
              if (n.rr_dataURL !== null) {
                const a = document.createElement("img");
                (a.onload = () => {
                  const l = i.getContext("2d");
                  l && l.drawImage(a, 0, 0, a.width, a.height);
                }),
                  (a.src = n.rr_dataURL);
              }
              n.canvasMutations.forEach((a) => t.applyCanvas(a.event, a.mutation, s));
              break;
            }
            case "STYLE": {
              const n = i.sheet;
              n && e.rules.forEach((a) => t.applyStyleSheetMutation(a, n));
              break;
            }
            case "DIALOG": {
              const n = i,
                a = o,
                l = n.open,
                u = n.matches("dialog:modal"),
                c = a.open,
                h = a.isModal,
                f = u !== h,
                p = l !== c;
              if (((f || (l && p)) && n.close(), c && (p || f)))
                try {
                  h ? n.showModal() : n.show();
                } catch (g) {
                  console.warn(g);
                }
              break;
            }
          }
          break;
        }
        case O.Text:
        case O.Comment:
        case O.CDATA: {
          s.textContent !== e.data && (s.textContent = e.data);
          break;
        }
      }
      ge != null && ge.has(s) && (ge.delete(s), (r = t.afterAppend) == null || r.call(t, s, t.mirror.getId(s)));
    }
    function Gf(s, e, t) {
      const r = s.attributes,
        i = e.attributes;
      for (const o in i) {
        const n = i[o],
          a = t.getMeta(e);
        if (a != null && a.isSVG && Ts[o]) s.setAttributeNS(Ts[o], o, n);
        else if (e.tagName === "CANVAS" && o === "rr_dataURL") {
          const l = document.createElement("img");
          (l.src = n),
            (l.onload = () => {
              const u = s.getContext("2d");
              u && u.drawImage(l, 0, 0, l.width, l.height);
            });
        } else {
          if (e.tagName === "IFRAME" && o === "srcdoc") continue;
          s.setAttribute(o, n);
        }
      }
      for (const { name: o } of Array.from(r)) o in i || s.removeAttribute(o);
      e.scrollLeft && (s.scrollLeft = e.scrollLeft), e.scrollTop && (s.scrollTop = e.scrollTop);
    }
    function Ca(s, e, t, r) {
      const i = Array.from(s.childNodes),
        o = e.childNodes;
      if (i.length === 0 && o.length === 0) return;
      let n = 0,
        a = i.length - 1,
        l = 0,
        u = o.length - 1,
        c = i[n],
        h = i[a],
        f = o[l],
        p = o[u],
        g,
        m;
      for (; n <= a && l <= u; )
        if (c === void 0) c = i[++n];
        else if (h === void 0) h = i[--a];
        else if (Be(c, f, t.mirror, r)) (c = i[++n]), (f = o[++l]);
        else if (Be(h, p, t.mirror, r)) (h = i[--a]), (p = o[--u]);
        else if (Be(c, p, t.mirror, r)) {
          try {
            s.insertBefore(c, h.nextSibling);
          } catch (S) {
            console.warn(S);
          }
          (c = i[++n]), (p = o[--u]);
        } else if (Be(h, f, t.mirror, r)) {
          try {
            s.insertBefore(h, c);
          } catch (S) {
            console.warn(S);
          }
          (h = i[--a]), (f = o[++l]);
        } else {
          if (!g) {
            g = {};
            for (let w = n; w <= a; w++) {
              const v = i[w];
              v && t.mirror.hasNode(v) && (g[t.mirror.getId(v)] = w);
            }
          }
          m = g[r.getId(f)];
          const S = i[m];
          if (m !== void 0 && S && Be(S, f, t.mirror, r)) {
            try {
              s.insertBefore(S, c);
            } catch (w) {
              console.warn(w);
            }
            i[m] = void 0;
          } else {
            const w = Sr(f, t.mirror, r);
            s.nodeName === "#document" &&
              c &&
              ((w.nodeType === w.DOCUMENT_TYPE_NODE && c.nodeType === c.DOCUMENT_TYPE_NODE) ||
                (w.nodeType === w.ELEMENT_NODE && c.nodeType === c.ELEMENT_NODE)) &&
              (s.removeChild(c), t.mirror.removeNodeFromMap(c), (c = i[++n]));
            try {
              s.insertBefore(w, c || null);
            } catch (v) {
              console.warn(v);
            }
          }
          f = o[++l];
        }
      if (n > a) {
        const S = o[u + 1];
        let w = null;
        for (S && (w = t.mirror.getNode(r.getId(S))); l <= u; ++l) {
          const v = Sr(o[l], t.mirror, r);
          try {
            s.insertBefore(v, w);
          } catch (x) {
            console.warn(x);
          }
        }
      } else if (l > u)
        for (; n <= a; n++) {
          const S = i[n];
          if (!(!S || S.parentNode !== s))
            try {
              s.removeChild(S), t.mirror.removeNodeFromMap(S);
            } catch (w) {
              console.warn(w);
            }
        }
      let d = s.firstChild,
        y = e.firstChild;
      for (; d !== null && y !== null; ) br(d, y, t, r), (d = d.nextSibling), (y = y.nextSibling);
    }
    function Sr(s, e, t) {
      const r = t.getId(s),
        i = t.getMeta(s);
      let o = null;
      if ((r > -1 && (o = e.getNode(r)), o !== null && ci(o, s))) return o;
      switch (s.RRNodeType) {
        case O.Document:
          o = new Document();
          break;
        case O.DocumentType:
          o = document.implementation.createDocumentType(s.name, s.publicId, s.systemId);
          break;
        case O.Element: {
          let n = s.tagName.toLowerCase();
          (n = Wf[n] || n),
            i && "isSVG" in i && i != null && i.isSVG
              ? (o = document.createElementNS(Ts.svg, n))
              : (o = document.createElement(s.tagName));
          break;
        }
        case O.Text:
          o = document.createTextNode(s.data);
          break;
        case O.Comment:
          o = document.createComment(s.data);
          break;
        case O.CDATA:
          o = document.createCDATASection(s.data);
          break;
      }
      i && e.add(o, R({}, i));
      try {
        ge == null || ge.add(o);
      } catch (n) {}
      return o;
    }
    function ci(s, e) {
      return s.nodeType !== e.nodeType ? !1 : s.nodeType !== s.ELEMENT_NODE || s.tagName.toUpperCase() === e.tagName;
    }
    function Be(s, e, t, r) {
      const i = t.getId(s),
        o = r.getId(e);
      return i === -1 || i !== o ? !1 : ci(s, e);
    }
    class tt extends li {
      constructor(e) {
        super(),
          C(this, "UNSERIALIZED_STARTING_ID", -2),
          C(this, "_unserializedId", this.UNSERIALIZED_STARTING_ID),
          C(this, "mirror", rd()),
          C(this, "scrollData", null),
          e && (this.mirror = e);
      }
      get unserializedId() {
        return this._unserializedId--;
      }
      createDocument(e, t, r) {
        return new tt();
      }
      createDocumentType(e, t, r) {
        const i = new jf(e, t, r);
        return (i.ownerDocument = this), i;
      }
      createElement(e) {
        const t = e.toUpperCase();
        let r;
        switch (t) {
          case "AUDIO":
          case "VIDEO":
            r = new Yf(t);
            break;
          case "IFRAME":
            r = new Jf(t, this.mirror);
            break;
          case "CANVAS":
            r = new Zf(t);
            break;
          case "STYLE":
            r = new Xf(t);
            break;
          case "DIALOG":
            r = new Hf(t);
            break;
          default:
            r = new Pr(t);
            break;
        }
        return (r.ownerDocument = this), r;
      }
      createComment(e) {
        const t = new Qf(e);
        return (t.ownerDocument = this), t;
      }
      createCDATASection(e) {
        const t = new qf(e);
        return (t.ownerDocument = this), t;
      }
      createTextNode(e) {
        const t = new Kf(e);
        return (t.ownerDocument = this), t;
      }
      destroyTree() {
        (this.firstChild = null), (this.lastChild = null), this.mirror.reset();
      }
      open() {
        super.open(), (this._unserializedId = this.UNSERIALIZED_STARTING_ID);
      }
    }
    const jf = ga;
    class Pr extends $r {
      constructor() {
        super(...arguments), C(this, "inputData", null), C(this, "scrollData", null);
      }
    }
    class Yf extends Ff {}
    class Hf extends Bf {}
    class Zf extends Pr {
      constructor() {
        super(...arguments), C(this, "rr_dataURL", null), C(this, "canvasMutations", []);
      }
      getContext() {
        return null;
      }
    }
    class Xf extends Pr {
      constructor() {
        super(...arguments), C(this, "rules", []);
      }
    }
    class Jf extends Pr {
      constructor(e, t) {
        super(e), C(this, "contentDocument", new tt()), (this.contentDocument.mirror = t);
      }
    }
    const Kf = ya,
      Qf = wa,
      qf = ba;
    function ed(s) {
      return s instanceof HTMLFormElement ? "FORM" : s.tagName.toUpperCase();
    }
    function Ea(s, e, t, r) {
      let i;
      switch (s.nodeType) {
        case oe.DOCUMENT_NODE:
          r && r.nodeName === "IFRAME" ? (i = r.contentDocument) : ((i = e), (i.compatMode = s.compatMode));
          break;
        case oe.DOCUMENT_TYPE_NODE: {
          const n = s;
          i = e.createDocumentType(n.name, n.publicId, n.systemId);
          break;
        }
        case oe.ELEMENT_NODE: {
          const n = s,
            a = ed(n);
          i = e.createElement(a);
          const l = i;
          for (const { name: u, value: c } of Array.from(n.attributes)) l.attributes[u] = c;
          n.scrollLeft && (l.scrollLeft = n.scrollLeft), n.scrollTop && (l.scrollTop = n.scrollTop);
          break;
        }
        case oe.TEXT_NODE:
          i = e.createTextNode(s.textContent || "");
          break;
        case oe.CDATA_SECTION_NODE:
          i = e.createCDATASection(s.data);
          break;
        case oe.COMMENT_NODE:
          i = e.createComment(s.textContent || "");
          break;
        case oe.DOCUMENT_FRAGMENT_NODE:
          i = r.attachShadow({ mode: "open" });
          break;
        default:
          return null;
      }
      let o = t.getMeta(s);
      return e instanceof tt && (o || ((o = Ia(i, e.unserializedId)), t.add(s, o)), e.mirror.add(i, R({}, o))), i;
    }
    function td(s, e = zc(), t = new tt()) {
      function r(i, o) {
        const n = Ea(i, t, e, o);
        if (n !== null)
          if (
            ((o == null ? void 0 : o.nodeName) !== "IFRAME" &&
              i.nodeType !== oe.DOCUMENT_FRAGMENT_NODE &&
              (o == null || o.appendChild(n), (n.parentNode = o), (n.parentElement = o)),
            i.nodeName === "IFRAME")
          ) {
            const a = i.contentDocument;
            a && r(a, n);
          } else
            (i.nodeType === oe.DOCUMENT_NODE ||
              i.nodeType === oe.ELEMENT_NODE ||
              i.nodeType === oe.DOCUMENT_FRAGMENT_NODE) &&
              (i.nodeType === oe.ELEMENT_NODE && i.shadowRoot && r(i.shadowRoot, n),
              i.childNodes.forEach((a) => r(a, n)));
      }
      return r(s, null), t;
    }
    function rd() {
      return new sd();
    }
    class sd {
      constructor() {
        C(this, "idNodeMap", new Map()), C(this, "nodeMetaMap", new WeakMap());
      }
      getId(e) {
        var t;
        if (!e) return -1;
        const r = (t = this.getMeta(e)) == null ? void 0 : t.id;
        return r != null ? r : -1;
      }
      getNode(e) {
        return this.idNodeMap.get(e) || null;
      }
      getIds() {
        return Array.from(this.idNodeMap.keys());
      }
      getMeta(e) {
        return this.nodeMetaMap.get(e) || null;
      }
      removeNodeFromMap(e) {
        const t = this.getId(e);
        this.idNodeMap.delete(t), e.childNodes && e.childNodes.forEach((r) => this.removeNodeFromMap(r));
      }
      has(e) {
        return this.idNodeMap.has(e);
      }
      hasNode(e) {
        return this.nodeMetaMap.has(e);
      }
      add(e, t) {
        const r = t.id;
        this.idNodeMap.set(r, e), this.nodeMetaMap.set(e, t);
      }
      replace(e, t) {
        const r = this.getNode(e);
        if (r) {
          const i = this.nodeMetaMap.get(r);
          i && this.nodeMetaMap.set(t, i);
        }
        this.idNodeMap.set(e, t);
      }
      reset() {
        (this.idNodeMap = new Map()), (this.nodeMetaMap = new WeakMap());
      }
    }
    function Ia(s, e) {
      switch (s.RRNodeType) {
        case O.Document:
          return { id: e, type: s.RRNodeType, childNodes: [] };
        case O.DocumentType: {
          const t = s;
          return {
            id: e,
            type: s.RRNodeType,
            name: t.name,
            publicId: t.publicId,
            systemId: t.systemId,
          };
        }
        case O.Element:
          return {
            id: e,
            type: s.RRNodeType,
            tagName: s.tagName.toLowerCase(),
            attributes: {},
            childNodes: [],
          };
        case O.Text:
          return {
            id: e,
            type: s.RRNodeType,
            textContent: s.textContent || "",
          };
        case O.Comment:
          return {
            id: e,
            type: s.RRNodeType,
            textContent: s.textContent || "",
          };
        case O.CDATA:
          return { id: e, type: s.RRNodeType, textContent: "" };
      }
    }
    const Cn = {
        Node: ["childNodes", "parentNode", "parentElement", "textContent"],
        ShadowRoot: ["host", "styleSheets"],
        Element: ["shadowRoot", "querySelector", "querySelectorAll"],
        MutationObserver: [],
      },
      En = {
        Node: ["contains", "getRootNode"],
        ShadowRoot: ["getSelection"],
        Element: [],
        MutationObserver: ["constructor"],
      },
      Jt = {};
    function hi(s) {
      if (Jt[s]) return Jt[s];
      const e = globalThis[s],
        t = e.prototype,
        r = s in Cn ? Cn[s] : void 0,
        i = !!(
          r &&
          r.every((a) => {
            var l, u;
            return !!(
              (u = (l = Object.getOwnPropertyDescriptor(t, a)) == null ? void 0 : l.get) != null &&
              u.toString().includes("[native code]")
            );
          })
        ),
        o = s in En ? En[s] : void 0,
        n = !!(
          o &&
          o.every((a) => {
            var l;
            return typeof t[a] == "function" && ((l = t[a]) == null ? void 0 : l.toString().includes("[native code]"));
          })
        );
      if (i && n) return (Jt[s] = e.prototype), e.prototype;
      try {
        const a = document.createElement("iframe");
        document.body.appendChild(a);
        const l = a.contentWindow;
        if (!l) return e.prototype;
        const u = l[s].prototype;
        return document.body.removeChild(a), u ? (Jt[s] = u) : t;
      } catch (a) {
        return t;
      }
    }
    const Jr = {};
    function Re(s, e, t) {
      var r;
      const i = `${s}.${String(t)}`;
      if (Jr[i]) return Jr[i].call(e);
      const o = hi(s),
        n = (r = Object.getOwnPropertyDescriptor(o, t)) == null ? void 0 : r.get;
      return n ? ((Jr[i] = n), n.call(e)) : e[t];
    }
    const Kr = {};
    function xa(s, e, t) {
      const r = `${s}.${String(t)}`;
      if (Kr[r]) return Kr[r].bind(e);
      const o = hi(s)[t];
      return typeof o != "function" ? e[t] : ((Kr[r] = o), o.bind(e));
    }
    function id(s) {
      return Re("Node", s, "childNodes");
    }
    function nd(s) {
      return Re("Node", s, "parentNode");
    }
    function od(s) {
      return Re("Node", s, "parentElement");
    }
    function ad(s) {
      return Re("Node", s, "textContent");
    }
    function ld(s, e) {
      return xa("Node", s, "contains")(e);
    }
    function ud(s) {
      return xa("Node", s, "getRootNode")();
    }
    function cd(s) {
      return !s || !("host" in s) ? null : Re("ShadowRoot", s, "host");
    }
    function hd(s) {
      return s.styleSheets;
    }
    function fd(s) {
      return !s || !("shadowRoot" in s) ? null : Re("Element", s, "shadowRoot");
    }
    function dd(s, e) {
      return Re("Element", s, "querySelector")(e);
    }
    function pd(s, e) {
      return Re("Element", s, "querySelectorAll")(e);
    }
    function Ma() {
      return hi("MutationObserver").constructor;
    }
    const A = {
      childNodes: id,
      parentNode: nd,
      parentElement: od,
      textContent: ad,
      contains: ld,
      getRootNode: ud,
      host: cd,
      styleSheets: hd,
      shadowRoot: fd,
      querySelector: dd,
      querySelectorAll: pd,
      mutationObserver: Ma,
    };
    function te(s, e, t = document) {
      const r = { capture: !0, passive: !0 };
      return t.addEventListener(s, e, r), () => t.removeEventListener(s, e, r);
    }
    const Ue = `Please stop import mirror directly. Instead of that,\r
now you can use replayer.getMirror() to access the mirror instance of a replayer,\r
or you can use record.mirror to access the mirror instance during recording.`;
    exports.mirror = {
      map: {},
      getId() {
        return console.error(Ue), -1;
      },
      getNode() {
        return console.error(Ue), null;
      },
      removeNodeFromMap() {
        console.error(Ue);
      },
      has() {
        return console.error(Ue), !1;
      },
      reset() {
        console.error(Ue);
      },
    };
    typeof window != "undefined" &&
      window.Proxy &&
      window.Reflect &&
      (exports.mirror = new Proxy(exports.mirror, {
        get(s, e, t) {
          return e === "map" && console.error(Ue), Reflect.get(s, e, t);
        },
      }));
    function et(s, e, t = {}) {
      let r = null,
        i = 0;
      return function (...o) {
        const n = Date.now();
        !i && t.leading === !1 && (i = n);
        const a = e - (n - i),
          l = this;
        a <= 0 || a > e
          ? (r && (clearTimeout(r), (r = null)), (i = n), s.apply(l, o))
          : !r &&
            t.trailing !== !1 &&
            (r = setTimeout(() => {
              (i = t.leading === !1 ? 0 : Date.now()), (r = null), s.apply(l, o);
            }, a));
      };
    }
    function Mt(s, e, t, r, i = window) {
      const o = i.Object.getOwnPropertyDescriptor(s, e);
      return (
        i.Object.defineProperty(
          s,
          e,
          r
            ? t
            : {
                set(n) {
                  setTimeout(() => {
                    t.set.call(this, n);
                  }, 0),
                    o && o.set && o.set.call(this, n);
                },
              },
        ),
        () => Mt(s, e, o || {}, !0)
      );
    }
    function $e(s, e, t) {
      try {
        if (!(e in s)) return () => {};
        const r = s[e],
          i = t(r);
        return (
          typeof i == "function" &&
            ((i.prototype = i.prototype || {}),
            Object.defineProperties(i, {
              __rrweb_original__: { enumerable: !1, value: r },
            })),
          (s[e] = i),
          () => {
            s[e] = r;
          }
        );
      } catch (r) {
        return () => {};
      }
    }
    let vt = Date.now;
    /[1-9][0-9]{12}/.test(Date.now().toString()) || (vt = () => new Date().getTime());
    function fi(s) {
      var e, t, r, i;
      const o = s.document;
      return {
        left: o.scrollingElement
          ? o.scrollingElement.scrollLeft
          : s.pageXOffset !== void 0
          ? s.pageXOffset
          : o.documentElement.scrollLeft ||
            ((o == null ? void 0 : o.body) && ((e = A.parentElement(o.body)) == null ? void 0 : e.scrollLeft)) ||
            ((t = o == null ? void 0 : o.body) == null ? void 0 : t.scrollLeft) ||
            0,
        top: o.scrollingElement
          ? o.scrollingElement.scrollTop
          : s.pageYOffset !== void 0
          ? s.pageYOffset
          : (o == null ? void 0 : o.documentElement.scrollTop) ||
            ((o == null ? void 0 : o.body) && ((r = A.parentElement(o.body)) == null ? void 0 : r.scrollTop)) ||
            ((i = o == null ? void 0 : o.body) == null ? void 0 : i.scrollTop) ||
            0,
      };
    }
    function di() {
      return (
        window.innerHeight ||
        (document.documentElement && document.documentElement.clientHeight) ||
        (document.body && document.body.clientHeight)
      );
    }
    function pi() {
      return (
        window.innerWidth ||
        (document.documentElement && document.documentElement.clientWidth) ||
        (document.body && document.body.clientWidth)
      );
    }
    function mi(s) {
      return s ? (s.nodeType === s.ELEMENT_NODE ? s : A.parentElement(s)) : null;
    }
    function re(s, e, t, r) {
      if (!s) return !1;
      const i = mi(s);
      if (!i) return !1;
      try {
        if (typeof e == "string") {
          if (i.classList.contains(e) || (r && i.closest("." + e) !== null)) return !0;
        } else if (cr(i, e, r)) return !0;
      } catch (o) {}
      return !!(t && (i.matches(t) || (r && i.closest(t) !== null)));
    }
    function Ra(s, e) {
      return e.getId(s) !== -1;
    }
    function nr(s, e, t) {
      return s.tagName === "TITLE" && t.headTitleMutations ? !0 : e.getId(s) === ft;
    }
    function gi(s, e) {
      if (lt(s)) return !1;
      const t = e.getId(s);
      if (!e.has(t)) return !0;
      const r = A.parentNode(s);
      return r && r.nodeType === s.DOCUMENT_NODE ? !1 : r ? gi(r, e) : !0;
    }
    function vr(s) {
      return !!s.changedTouches;
    }
    function yi(s = window) {
      "NodeList" in s && !s.NodeList.prototype.forEach && (s.NodeList.prototype.forEach = Array.prototype.forEach),
        "DOMTokenList" in s &&
          !s.DOMTokenList.prototype.forEach &&
          (s.DOMTokenList.prototype.forEach = Array.prototype.forEach);
    }
    function Na(s) {
      const e = {},
        t = (i, o) => {
          const n = { value: i, parent: o, children: [] };
          return (e[i.node.id] = n), n;
        },
        r = [];
      for (const i of s) {
        const { nextId: o, parentId: n } = i;
        if (o && o in e) {
          const a = e[o];
          if (a.parent) {
            const l = a.parent.children.indexOf(a);
            a.parent.children.splice(l, 0, t(i, a.parent));
          } else {
            const l = r.indexOf(a);
            r.splice(l, 0, t(i, null));
          }
          continue;
        }
        if (n in e) {
          const a = e[n];
          a.children.push(t(i, a));
          continue;
        }
        r.push(t(i, null));
      }
      return r;
    }
    function wi(s, e) {
      e(s.value);
      for (let t = s.children.length - 1; t >= 0; t--) wi(s.children[t], e);
    }
    function He(s, e) {
      return !!(s.nodeName === "IFRAME" && e.getMeta(s));
    }
    function bi(s, e) {
      return !!(
        s.nodeName === "LINK" &&
        s.nodeType === s.ELEMENT_NODE &&
        s.getAttribute &&
        s.getAttribute("rel") === "stylesheet" &&
        e.getMeta(s)
      );
    }
    function Si(s, e) {
      var t, r;
      const i = (r = (t = s.ownerDocument) == null ? void 0 : t.defaultView) == null ? void 0 : r.frameElement;
      if (!i || i === e) return { x: 0, y: 0, relativeScale: 1, absoluteScale: 1 };
      const o = i.getBoundingClientRect(),
        n = Si(i, e),
        a = o.height / i.clientHeight;
      return {
        x: o.x * n.relativeScale + n.x,
        y: o.y * n.relativeScale + n.y,
        relativeScale: a,
        absoluteScale: n.absoluteScale * a,
      };
    }
    function Ee(s) {
      return s ? (s instanceof he && "shadowRoot" in s ? !!s.shadowRoot : !!A.shadowRoot(s)) : !1;
    }
    function Ge(s, e) {
      const t = s[e[0]];
      return e.length === 1 ? t : Ge(t.cssRules[e[1]].cssRules, e.slice(2));
    }
    function _s(s) {
      const e = [...s],
        t = e.pop();
      return { positions: e, index: t };
    }
    function Aa(s) {
      const e = new Set(),
        t = [];
      for (let r = s.length; r--; ) {
        const i = s[r];
        e.has(i.id) || (t.push(i), e.add(i.id));
      }
      return t;
    }
    class vi {
      constructor() {
        b(this, "id", 1), b(this, "styleIDMap", new WeakMap()), b(this, "idStyleMap", new Map());
      }
      getId(e) {
        var t;
        return (t = this.styleIDMap.get(e)) != null ? t : -1;
      }
      has(e) {
        return this.styleIDMap.has(e);
      }
      add(e, t) {
        if (this.has(e)) return this.getId(e);
        let r;
        return t === void 0 ? (r = this.id++) : (r = t), this.styleIDMap.set(e, r), this.idStyleMap.set(r, e), r;
      }
      getStyle(e) {
        return this.idStyleMap.get(e) || null;
      }
      reset() {
        (this.styleIDMap = new WeakMap()), (this.idStyleMap = new Map()), (this.id = 1);
      }
      generateId() {
        return this.id++;
      }
    }
    function Ci(s) {
      var e;
      let t = null;
      return (
        "getRootNode" in s &&
          ((e = A.getRootNode(s)) == null ? void 0 : e.nodeType) === Node.DOCUMENT_FRAGMENT_NODE &&
          A.host(A.getRootNode(s)) &&
          (t = A.host(A.getRootNode(s))),
        t
      );
    }
    function Oa(s) {
      let e = s,
        t;
      for (; (t = Ci(e)); ) e = t;
      return e;
    }
    function Da(s) {
      const e = s.ownerDocument;
      if (!e) return !1;
      const t = Oa(s);
      return A.contains(e, t);
    }
    function Ei(s) {
      const e = s.ownerDocument;
      return e ? A.contains(e, s) || Da(s) : !1;
    }
    const md = Object.freeze(
      Object.defineProperty(
        {
          __proto__: null,
          StyleSheetMirror: vi,
          get _mirror() {
            return exports.mirror;
          },
          closestElementOfNode: mi,
          getBaseDimension: Si,
          getNestedRule: Ge,
          getPositionsAndIndex: _s,
          getRootShadowHost: Oa,
          getShadowHost: Ci,
          getWindowHeight: di,
          getWindowScroll: fi,
          getWindowWidth: pi,
          hasShadowRoot: Ee,
          hookSetter: Mt,
          inDom: Ei,
          isAncestorRemoved: gi,
          isBlocked: re,
          isIgnored: nr,
          isSerialized: Ra,
          isSerializedIframe: He,
          isSerializedStylesheet: bi,
          iterateResolveTree: wi,
          legacy_isTouchEvent: vr,
          get nowTimestamp() {
            return vt;
          },
          on: te,
          patch: $e,
          polyfill: yi,
          queueToResolveTrees: Na,
          shadowHostInDom: Da,
          throttle: et,
          uniqueTextMutations: Aa,
        },
        Symbol.toStringTag,
        { value: "Module" },
      ),
    );
    var I = ((s) => (
        (s[(s.DomContentLoaded = 0)] = "DomContentLoaded"),
        (s[(s.Load = 1)] = "Load"),
        (s[(s.FullSnapshot = 2)] = "FullSnapshot"),
        (s[(s.IncrementalSnapshot = 3)] = "IncrementalSnapshot"),
        (s[(s.Meta = 4)] = "Meta"),
        (s[(s.Custom = 5)] = "Custom"),
        (s[(s.Plugin = 6)] = "Plugin"),
        s
      ))(I || {}),
      E = ((s) => (
        (s[(s.Mutation = 0)] = "Mutation"),
        (s[(s.MouseMove = 1)] = "MouseMove"),
        (s[(s.MouseInteraction = 2)] = "MouseInteraction"),
        (s[(s.Scroll = 3)] = "Scroll"),
        (s[(s.ViewportResize = 4)] = "ViewportResize"),
        (s[(s.Input = 5)] = "Input"),
        (s[(s.TouchMove = 6)] = "TouchMove"),
        (s[(s.MediaInteraction = 7)] = "MediaInteraction"),
        (s[(s.StyleSheetRule = 8)] = "StyleSheetRule"),
        (s[(s.CanvasMutation = 9)] = "CanvasMutation"),
        (s[(s.Font = 10)] = "Font"),
        (s[(s.Log = 11)] = "Log"),
        (s[(s.Drag = 12)] = "Drag"),
        (s[(s.StyleDeclaration = 13)] = "StyleDeclaration"),
        (s[(s.Selection = 14)] = "Selection"),
        (s[(s.AdoptedStyleSheet = 15)] = "AdoptedStyleSheet"),
        (s[(s.CustomElement = 16)] = "CustomElement"),
        s
      ))(E || {}),
      $ = ((s) => (
        (s[(s.MouseUp = 0)] = "MouseUp"),
        (s[(s.MouseDown = 1)] = "MouseDown"),
        (s[(s.Click = 2)] = "Click"),
        (s[(s.ContextMenu = 3)] = "ContextMenu"),
        (s[(s.DblClick = 4)] = "DblClick"),
        (s[(s.Focus = 5)] = "Focus"),
        (s[(s.Blur = 6)] = "Blur"),
        (s[(s.TouchStart = 7)] = "TouchStart"),
        (s[(s.TouchMove_Departed = 8)] = "TouchMove_Departed"),
        (s[(s.TouchEnd = 9)] = "TouchEnd"),
        (s[(s.TouchCancel = 10)] = "TouchCancel"),
        s
      ))($ || {}),
      ye = ((s) => ((s[(s.Mouse = 0)] = "Mouse"), (s[(s.Pen = 1)] = "Pen"), (s[(s.Touch = 2)] = "Touch"), s))(ye || {}),
      Se = ((s) => ((s[(s["2D"] = 0)] = "2D"), (s[(s.WebGL = 1)] = "WebGL"), (s[(s.WebGL2 = 2)] = "WebGL2"), s))(
        Se || {},
      ),
      Ce = ((s) => (
        (s[(s.Play = 0)] = "Play"),
        (s[(s.Pause = 1)] = "Pause"),
        (s[(s.Seeked = 2)] = "Seeked"),
        (s[(s.VolumeChange = 3)] = "VolumeChange"),
        (s[(s.RateChange = 4)] = "RateChange"),
        s
      ))(Ce || {}),
      k = ((s) => (
        (s.Start = "start"),
        (s.Pause = "pause"),
        (s.Resume = "resume"),
        (s.Resize = "resize"),
        (s.Finish = "finish"),
        (s.FullsnapshotRebuilded = "fullsnapshot-rebuilded"),
        (s.LoadStylesheetStart = "load-stylesheet-start"),
        (s.LoadStylesheetEnd = "load-stylesheet-end"),
        (s.SkipStart = "skip-start"),
        (s.SkipEnd = "skip-end"),
        (s.MouseInteraction = "mouse-interaction"),
        (s.EventCast = "event-cast"),
        (s.CustomEvent = "custom-event"),
        (s.Flush = "flush"),
        (s.StateChange = "state-change"),
        (s.PlayBack = "play-back"),
        (s.Destroy = "destroy"),
        s
      ))(k || {});
    function In(s) {
      return "__ln" in s;
    }
    class gd {
      constructor() {
        b(this, "length", 0), b(this, "head", null), b(this, "tail", null);
      }
      get(e) {
        if (e >= this.length) throw new Error("Position outside of list range");
        let t = this.head;
        for (let r = 0; r < e; r++) t = (t == null ? void 0 : t.next) || null;
        return t;
      }
      addNode(e) {
        const t = { value: e, previous: null, next: null };
        if (((e.__ln = t), e.previousSibling && In(e.previousSibling))) {
          const r = e.previousSibling.__ln.next;
          (t.next = r), (t.previous = e.previousSibling.__ln), (e.previousSibling.__ln.next = t), r && (r.previous = t);
        } else if (e.nextSibling && In(e.nextSibling) && e.nextSibling.__ln.previous) {
          const r = e.nextSibling.__ln.previous;
          (t.previous = r), (t.next = e.nextSibling.__ln), (e.nextSibling.__ln.previous = t), r && (r.next = t);
        } else this.head && (this.head.previous = t), (t.next = this.head), (this.head = t);
        t.next === null && (this.tail = t), this.length++;
      }
      removeNode(e) {
        const t = e.__ln;
        this.head &&
          (t.previous
            ? ((t.previous.next = t.next), t.next ? (t.next.previous = t.previous) : (this.tail = t.previous))
            : ((this.head = t.next), this.head ? (this.head.previous = null) : (this.tail = null)),
          e.__ln && delete e.__ln,
          this.length--);
      }
    }
    const xn = (s, e) => `${s}@${e}`;
    class yd {
      constructor() {
        b(this, "frozen", !1),
          b(this, "locked", !1),
          b(this, "texts", []),
          b(this, "attributes", []),
          b(this, "attributeMap", new WeakMap()),
          b(this, "removes", []),
          b(this, "mapRemoves", []),
          b(this, "movedMap", {}),
          b(this, "addedSet", new Set()),
          b(this, "movedSet", new Set()),
          b(this, "droppedSet", new Set()),
          b(this, "mutationCb"),
          b(this, "blockClass"),
          b(this, "blockSelector"),
          b(this, "maskTextClass"),
          b(this, "maskTextSelector"),
          b(this, "inlineStylesheet"),
          b(this, "maskInputOptions"),
          b(this, "maskTextFn"),
          b(this, "maskInputFn"),
          b(this, "keepIframeSrcFn"),
          b(this, "recordCanvas"),
          b(this, "inlineImages"),
          b(this, "slimDOMOptions"),
          b(this, "dataURLOptions"),
          b(this, "doc"),
          b(this, "mirror"),
          b(this, "iframeManager"),
          b(this, "stylesheetManager"),
          b(this, "shadowDomManager"),
          b(this, "canvasManager"),
          b(this, "processedNodeManager"),
          b(this, "unattachedDoc"),
          b(this, "processMutations", (e) => {
            e.forEach(this.processMutation), this.emit();
          }),
          b(this, "emit", () => {
            if (this.frozen || this.locked) return;
            const e = [],
              t = new Set(),
              r = new gd(),
              i = (l) => {
                let u = l,
                  c = ft;
                for (; c === ft; ) (u = u && u.nextSibling), (c = u && this.mirror.getId(u));
                return c;
              },
              o = (l) => {
                const u = A.parentNode(l);
                if (!u || !Ei(l) || u.tagName === "TEXTAREA") return;
                const c = lt(u) ? this.mirror.getId(Ci(l)) : this.mirror.getId(u),
                  h = i(l);
                if (c === -1 || h === -1) return r.addNode(l);
                const f = Ve(l, {
                  doc: this.doc,
                  mirror: this.mirror,
                  blockClass: this.blockClass,
                  blockSelector: this.blockSelector,
                  maskTextClass: this.maskTextClass,
                  maskTextSelector: this.maskTextSelector,
                  skipChild: !0,
                  newlyAddedElement: !0,
                  inlineStylesheet: this.inlineStylesheet,
                  maskInputOptions: this.maskInputOptions,
                  maskTextFn: this.maskTextFn,
                  maskInputFn: this.maskInputFn,
                  slimDOMOptions: this.slimDOMOptions,
                  dataURLOptions: this.dataURLOptions,
                  recordCanvas: this.recordCanvas,
                  inlineImages: this.inlineImages,
                  onSerialize: (p) => {
                    He(p, this.mirror) && this.iframeManager.addIframe(p),
                      bi(p, this.mirror) && this.stylesheetManager.trackLinkElement(p),
                      Ee(l) && this.shadowDomManager.addShadowRoot(A.shadowRoot(l), this.doc);
                  },
                  onIframeLoad: (p, g) => {
                    this.iframeManager.attachIframe(p, g), this.shadowDomManager.observeAttachShadow(p);
                  },
                  onStylesheetLoad: (p, g) => {
                    this.stylesheetManager.attachLinkElement(p, g);
                  },
                });
                f && (e.push({ parentId: c, nextId: h, node: f }), t.add(f.id));
              };
            for (; this.mapRemoves.length; ) this.mirror.removeNodeFromMap(this.mapRemoves.shift());
            for (const l of this.movedSet)
              (Mn(this.removes, l, this.mirror) && !this.movedSet.has(A.parentNode(l))) || o(l);
            for (const l of this.addedSet)
              (!Rn(this.droppedSet, l) && !Mn(this.removes, l, this.mirror)) || Rn(this.movedSet, l)
                ? o(l)
                : this.droppedSet.add(l);
            let n = null;
            for (; r.length; ) {
              let l = null;
              if (n) {
                const u = this.mirror.getId(A.parentNode(n.value)),
                  c = i(n.value);
                u !== -1 && c !== -1 && (l = n);
              }
              if (!l) {
                let u = r.tail;
                for (; u; ) {
                  const c = u;
                  if (((u = u.previous), c)) {
                    const h = this.mirror.getId(A.parentNode(c.value));
                    if (i(c.value) === -1) continue;
                    if (h !== -1) {
                      l = c;
                      break;
                    } else {
                      const p = c.value,
                        g = A.parentNode(p);
                      if (g && g.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
                        const m = A.host(g);
                        if (this.mirror.getId(m) !== -1) {
                          l = c;
                          break;
                        }
                      }
                    }
                  }
                }
              }
              if (!l) {
                for (; r.head; ) r.removeNode(r.head.value);
                break;
              }
              (n = l.previous), r.removeNode(l.value), o(l.value);
            }
            const a = {
              texts: this.texts
                .map((l) => {
                  const u = l.node,
                    c = A.parentNode(u);
                  return (
                    c && c.tagName === "TEXTAREA" && this.genTextAreaValueMutation(c),
                    { id: this.mirror.getId(u), value: l.value }
                  );
                })
                .filter((l) => !t.has(l.id))
                .filter((l) => this.mirror.has(l.id)),
              attributes: this.attributes
                .map((l) => {
                  const { attributes: u } = l;
                  if (typeof u.style == "string") {
                    const c = JSON.stringify(l.styleDiff),
                      h = JSON.stringify(l._unchangedStyles);
                    c.length < u.style.length &&
                      (c + h).split("var(").length === u.style.split("var(").length &&
                      (u.style = l.styleDiff);
                  }
                  return { id: this.mirror.getId(l.node), attributes: u };
                })
                .filter((l) => !t.has(l.id))
                .filter((l) => this.mirror.has(l.id)),
              removes: this.removes,
              adds: e,
            };
            (!a.texts.length && !a.attributes.length && !a.removes.length && !a.adds.length) ||
              ((this.texts = []),
              (this.attributes = []),
              (this.attributeMap = new WeakMap()),
              (this.removes = []),
              (this.addedSet = new Set()),
              (this.movedSet = new Set()),
              (this.droppedSet = new Set()),
              (this.movedMap = {}),
              this.mutationCb(a));
          }),
          b(this, "genTextAreaValueMutation", (e) => {
            let t = this.attributeMap.get(e);
            t ||
              ((t = {
                node: e,
                attributes: {},
                styleDiff: {},
                _unchangedStyles: {},
              }),
              this.attributes.push(t),
              this.attributeMap.set(e, t)),
              (t.attributes.value = Array.from(A.childNodes(e), (r) => A.textContent(r) || "").join(""));
          }),
          b(this, "processMutation", (e) => {
            if (!nr(e.target, this.mirror, this.slimDOMOptions))
              switch (e.type) {
                case "characterData": {
                  const t = A.textContent(e.target);
                  !re(e.target, this.blockClass, this.blockSelector, !1) &&
                    t !== e.oldValue &&
                    this.texts.push({
                      value:
                        Jn(e.target, this.maskTextClass, this.maskTextSelector, !0) && t
                          ? this.maskTextFn
                            ? this.maskTextFn(t, mi(e.target))
                            : t.replace(/[\S]/g, "*")
                          : t,
                      node: e.target,
                    });
                  break;
                }
                case "attributes": {
                  const t = e.target;
                  let r = e.attributeName,
                    i = e.target.getAttribute(r);
                  if (r === "value") {
                    const n = Us(t);
                    i = Bs({
                      element: t,
                      maskInputOptions: this.maskInputOptions,
                      tagName: t.tagName,
                      type: n,
                      value: i,
                      maskInputFn: this.maskInputFn,
                    });
                  }
                  if (re(e.target, this.blockClass, this.blockSelector, !1) || i === e.oldValue) return;
                  let o = this.attributeMap.get(e.target);
                  if (t.tagName === "IFRAME" && r === "src" && !this.keepIframeSrcFn(i))
                    if (!t.contentDocument) r = "rr_src";
                    else return;
                  if (
                    (o ||
                      ((o = {
                        node: e.target,
                        attributes: {},
                        styleDiff: {},
                        _unchangedStyles: {},
                      }),
                      this.attributes.push(o),
                      this.attributeMap.set(e.target, o)),
                    r === "type" &&
                      t.tagName === "INPUT" &&
                      (e.oldValue || "").toLowerCase() === "password" &&
                      t.setAttribute("data-rr-is-password", "true"),
                    !Xn(t.tagName, r))
                  )
                    if (((o.attributes[r] = Zn(this.doc, xe(t.tagName), xe(r), i)), r === "style")) {
                      if (!this.unattachedDoc)
                        try {
                          this.unattachedDoc = document.implementation.createHTMLDocument();
                        } catch (a) {
                          this.unattachedDoc = this.doc;
                        }
                      const n = this.unattachedDoc.createElement("span");
                      e.oldValue && n.setAttribute("style", e.oldValue);
                      for (const a of Array.from(t.style)) {
                        const l = t.style.getPropertyValue(a),
                          u = t.style.getPropertyPriority(a);
                        l !== n.style.getPropertyValue(a) || u !== n.style.getPropertyPriority(a)
                          ? u === ""
                            ? (o.styleDiff[a] = l)
                            : (o.styleDiff[a] = [l, u])
                          : (o._unchangedStyles[a] = [l, u]);
                      }
                      for (const a of Array.from(n.style)) t.style.getPropertyValue(a) === "" && (o.styleDiff[a] = !1);
                    } else
                      r === "open" &&
                        t.tagName === "DIALOG" &&
                        (t.matches("dialog:modal")
                          ? (o.attributes.rr_open_mode = "modal")
                          : (o.attributes.rr_open_mode = "non-modal"));
                  break;
                }
                case "childList": {
                  if (re(e.target, this.blockClass, this.blockSelector, !0)) return;
                  if (e.target.tagName === "TEXTAREA") {
                    this.genTextAreaValueMutation(e.target);
                    return;
                  }
                  e.addedNodes.forEach((t) => this.genAdds(t, e.target)),
                    e.removedNodes.forEach((t) => {
                      const r = this.mirror.getId(t),
                        i = lt(e.target) ? this.mirror.getId(A.host(e.target)) : this.mirror.getId(e.target);
                      re(e.target, this.blockClass, this.blockSelector, !1) ||
                        nr(t, this.mirror, this.slimDOMOptions) ||
                        !Ra(t, this.mirror) ||
                        (this.addedSet.has(t)
                          ? (ks(this.addedSet, t), this.droppedSet.add(t))
                          : (this.addedSet.has(e.target) && r === -1) ||
                            gi(e.target, this.mirror) ||
                            (this.movedSet.has(t) && this.movedMap[xn(r, i)]
                              ? ks(this.movedSet, t)
                              : this.removes.push({
                                  parentId: i,
                                  id: r,
                                  isShadow: lt(e.target) && ut(e.target) ? !0 : void 0,
                                })),
                        this.mapRemoves.push(t));
                    });
                  break;
                }
              }
          }),
          b(this, "genAdds", (e, t) => {
            if (!this.processedNodeManager.inOtherBuffer(e, this) && !(this.addedSet.has(e) || this.movedSet.has(e))) {
              if (this.mirror.hasNode(e)) {
                if (nr(e, this.mirror, this.slimDOMOptions)) return;
                this.movedSet.add(e);
                let r = null;
                t && this.mirror.hasNode(t) && (r = this.mirror.getId(t)),
                  r && r !== -1 && (this.movedMap[xn(this.mirror.getId(e), r)] = !0);
              } else this.addedSet.add(e), this.droppedSet.delete(e);
              re(e, this.blockClass, this.blockSelector, !1) ||
                (A.childNodes(e).forEach((r) => this.genAdds(r)),
                Ee(e) &&
                  A.childNodes(A.shadowRoot(e)).forEach((r) => {
                    this.processedNodeManager.add(r, this), this.genAdds(r, e);
                  }));
            }
          });
      }
      init(e) {
        [
          "mutationCb",
          "blockClass",
          "blockSelector",
          "maskTextClass",
          "maskTextSelector",
          "inlineStylesheet",
          "maskInputOptions",
          "maskTextFn",
          "maskInputFn",
          "keepIframeSrcFn",
          "recordCanvas",
          "inlineImages",
          "slimDOMOptions",
          "dataURLOptions",
          "doc",
          "mirror",
          "iframeManager",
          "stylesheetManager",
          "shadowDomManager",
          "canvasManager",
          "processedNodeManager",
        ].forEach((t) => {
          this[t] = e[t];
        });
      }
      freeze() {
        (this.frozen = !0), this.canvasManager.freeze();
      }
      unfreeze() {
        (this.frozen = !1), this.canvasManager.unfreeze(), this.emit();
      }
      isFrozen() {
        return this.frozen;
      }
      lock() {
        (this.locked = !0), this.canvasManager.lock();
      }
      unlock() {
        (this.locked = !1), this.canvasManager.unlock(), this.emit();
      }
      reset() {
        this.shadowDomManager.reset(), this.canvasManager.reset();
      }
    }
    function ks(s, e) {
      s.delete(e), A.childNodes(e).forEach((t) => ks(s, t));
    }
    function Mn(s, e, t) {
      return s.length === 0 ? !1 : wd(s, e, t);
    }
    function wd(s, e, t) {
      let r = A.parentNode(e);
      for (; r; ) {
        const i = t.getId(r);
        if (s.some((o) => o.id === i)) return !0;
        r = A.parentNode(r);
      }
      return !1;
    }
    function Rn(s, e) {
      return s.size === 0 ? !1 : Ta(s, e);
    }
    function Ta(s, e) {
      const t = A.parentNode(e);
      return t ? (s.has(t) ? !0 : Ta(s, t)) : !1;
    }
    let ht;
    function bd(s) {
      ht = s;
    }
    function Sd() {
      ht = void 0;
    }
    const _ = (s) =>
        ht
          ? (...t) => {
              try {
                return s(...t);
              } catch (r) {
                if (ht && ht(r) === !0) return;
                throw r;
              }
            }
          : s,
      Te = [];
    function Rt(s) {
      try {
        if ("composedPath" in s) {
          const e = s.composedPath();
          if (e.length) return e[0];
        } else if ("path" in s && s.path.length) return s.path[0];
      } catch (e) {}
      return s && s.target;
    }
    function _a(s, e) {
      const t = new yd();
      Te.push(t), t.init(s);
      const r = new (Ma())(_(t.processMutations.bind(t)));
      return (
        r.observe(e, {
          attributes: !0,
          attributeOldValue: !0,
          characterData: !0,
          characterDataOldValue: !0,
          childList: !0,
          subtree: !0,
        }),
        r
      );
    }
    function vd({ mousemoveCb: s, sampling: e, doc: t, mirror: r }) {
      if (e.mousemove === !1) return () => {};
      const i = typeof e.mousemove == "number" ? e.mousemove : 50,
        o = typeof e.mousemoveCallback == "number" ? e.mousemoveCallback : 500;
      let n = [],
        a;
      const l = et(
          _((h) => {
            const f = Date.now() - a;
            s(
              n.map((p) => ((p.timeOffset -= f), p)),
              h,
            ),
              (n = []),
              (a = null);
          }),
          o,
        ),
        u = _(
          et(
            _((h) => {
              const f = Rt(h),
                { clientX: p, clientY: g } = vr(h) ? h.changedTouches[0] : h;
              a || (a = vt()),
                n.push({ x: p, y: g, id: r.getId(f), timeOffset: vt() - a }),
                l(
                  typeof DragEvent != "undefined" && h instanceof DragEvent
                    ? E.Drag
                    : h instanceof MouseEvent
                    ? E.MouseMove
                    : E.TouchMove,
                );
            }),
            i,
            { trailing: !1 },
          ),
        ),
        c = [te("mousemove", u, t), te("touchmove", u, t), te("drag", u, t)];
      return _(() => {
        c.forEach((h) => h());
      });
    }
    function Cd({ mouseInteractionCb: s, doc: e, mirror: t, blockClass: r, blockSelector: i, sampling: o }) {
      if (o.mouseInteraction === !1) return () => {};
      const n = o.mouseInteraction === !0 || o.mouseInteraction === void 0 ? {} : o.mouseInteraction,
        a = [];
      let l = null;
      const u = (c) => (h) => {
        const f = Rt(h);
        if (re(f, r, i, !0)) return;
        let p = null,
          g = c;
        if ("pointerType" in h) {
          switch (h.pointerType) {
            case "mouse":
              p = ye.Mouse;
              break;
            case "touch":
              p = ye.Touch;
              break;
            case "pen":
              p = ye.Pen;
              break;
          }
          p === ye.Touch
            ? $[c] === $.MouseDown
              ? (g = "TouchStart")
              : $[c] === $.MouseUp && (g = "TouchEnd")
            : ye.Pen;
        } else vr(h) && (p = ye.Touch);
        p !== null
          ? ((l = p),
            ((g.startsWith("Touch") && p === ye.Touch) || (g.startsWith("Mouse") && p === ye.Mouse)) && (p = null))
          : $[c] === $.Click && ((p = l), (l = null));
        const m = vr(h) ? h.changedTouches[0] : h;
        if (!m) return;
        const d = t.getId(f),
          { clientX: y, clientY: S } = m;
        _(s)(R({ type: $[g], id: d, x: y, y: S }, p !== null && { pointerType: p }));
      };
      return (
        Object.keys($)
          .filter((c) => Number.isNaN(Number(c)) && !c.endsWith("_Departed") && n[c] !== !1)
          .forEach((c) => {
            let h = xe(c);
            const f = u(c);
            if (window.PointerEvent)
              switch ($[c]) {
                case $.MouseDown:
                case $.MouseUp:
                  h = h.replace("mouse", "pointer");
                  break;
                case $.TouchStart:
                case $.TouchEnd:
                  return;
              }
            a.push(te(h, f, e));
          }),
        _(() => {
          a.forEach((c) => c());
        })
      );
    }
    function ka({ scrollCb: s, doc: e, mirror: t, blockClass: r, blockSelector: i, sampling: o }) {
      const n = _(
        et(
          _((a) => {
            const l = Rt(a);
            if (!l || re(l, r, i, !0)) return;
            const u = t.getId(l);
            if (l === e && e.defaultView) {
              const c = fi(e.defaultView);
              s({ id: u, x: c.left, y: c.top });
            } else s({ id: u, x: l.scrollLeft, y: l.scrollTop });
          }),
          o.scroll || 100,
        ),
      );
      return te("scroll", n, e);
    }
    function Ed({ viewportResizeCb: s }, { win: e }) {
      let t = -1,
        r = -1;
      const i = _(
        et(
          _(() => {
            const o = di(),
              n = pi();
            (t !== o || r !== n) && (s({ width: Number(n), height: Number(o) }), (t = o), (r = n));
          }),
          200,
        ),
      );
      return te("resize", i, e);
    }
    const Id = ["INPUT", "TEXTAREA", "SELECT"],
      Nn = new WeakMap();
    function xd({
      inputCb: s,
      doc: e,
      mirror: t,
      blockClass: r,
      blockSelector: i,
      ignoreClass: o,
      ignoreSelector: n,
      maskInputOptions: a,
      maskInputFn: l,
      sampling: u,
      userTriggeredOnInput: c,
    }) {
      function h(S) {
        let w = Rt(S);
        const v = S.isTrusted,
          x = w && w.tagName;
        if (
          (w && x === "OPTION" && (w = A.parentElement(w)),
          !w || !x || Id.indexOf(x) < 0 || re(w, r, i, !0) || w.classList.contains(o) || (n && w.matches(n)))
        )
          return;
        let N = w.value,
          z = !1;
        const D = Us(w) || "";
        D === "radio" || D === "checkbox"
          ? (z = w.checked)
          : (a[x.toLowerCase()] || a[D]) &&
            (N = Bs({
              element: w,
              maskInputOptions: a,
              tagName: x,
              type: D,
              value: N,
              maskInputFn: l,
            })),
          f(w, c ? { text: N, isChecked: z, userTriggered: v } : { text: N, isChecked: z });
        const J = w.name;
        D === "radio" &&
          J &&
          z &&
          e.querySelectorAll(`input[type="radio"][name="${J}"]`).forEach((K) => {
            if (K !== w) {
              const se = K.value;
              f(K, c ? { text: se, isChecked: !z, userTriggered: !1 } : { text: se, isChecked: !z });
            }
          });
      }
      function f(S, w) {
        const v = Nn.get(S);
        if (!v || v.text !== w.text || v.isChecked !== w.isChecked) {
          Nn.set(S, w);
          const x = t.getId(S);
          _(s)(Q(R({}, w), { id: x }));
        }
      }
      const g = (u.input === "last" ? ["change"] : ["input", "change"]).map((S) => te(S, _(h), e)),
        m = e.defaultView;
      if (!m)
        return () => {
          g.forEach((S) => S());
        };
      const d = m.Object.getOwnPropertyDescriptor(m.HTMLInputElement.prototype, "value"),
        y = [
          [m.HTMLInputElement.prototype, "value"],
          [m.HTMLInputElement.prototype, "checked"],
          [m.HTMLSelectElement.prototype, "value"],
          [m.HTMLTextAreaElement.prototype, "value"],
          [m.HTMLSelectElement.prototype, "selectedIndex"],
          [m.HTMLOptionElement.prototype, "selected"],
        ];
      return (
        d &&
          d.set &&
          g.push(
            ...y.map((S) =>
              Mt(
                S[0],
                S[1],
                {
                  set() {
                    _(h)({ target: this, isTrusted: !1 });
                  },
                },
                !1,
                m,
              ),
            ),
          ),
        _(() => {
          g.forEach((S) => S());
        })
      );
    }
    function Cr(s) {
      const e = [];
      function t(r, i) {
        if (
          (Kt("CSSGroupingRule") && r.parentRule instanceof CSSGroupingRule) ||
          (Kt("CSSMediaRule") && r.parentRule instanceof CSSMediaRule) ||
          (Kt("CSSSupportsRule") && r.parentRule instanceof CSSSupportsRule) ||
          (Kt("CSSConditionRule") && r.parentRule instanceof CSSConditionRule)
        ) {
          const n = Array.from(r.parentRule.cssRules).indexOf(r);
          i.unshift(n);
        } else if (r.parentStyleSheet) {
          const n = Array.from(r.parentStyleSheet.cssRules).indexOf(r);
          i.unshift(n);
        }
        return i;
      }
      return t(s, e);
    }
    function ve(s, e, t) {
      let r, i;
      return s ? (s.ownerNode ? (r = e.getId(s.ownerNode)) : (i = t.getId(s)), { styleId: i, id: r }) : {};
    }
    function Md({ styleSheetRuleCb: s, mirror: e, stylesheetManager: t }, { win: r }) {
      if (!r.CSSStyleSheet || !r.CSSStyleSheet.prototype) return () => {};
      const i = r.CSSStyleSheet.prototype.insertRule;
      (r.CSSStyleSheet.prototype.insertRule = new Proxy(i, {
        apply: _((c, h, f) => {
          const [p, g] = f,
            { id: m, styleId: d } = ve(h, e, t.styleMirror);
          return (
            ((m && m !== -1) || (d && d !== -1)) && s({ id: m, styleId: d, adds: [{ rule: p, index: g }] }),
            c.apply(h, f)
          );
        }),
      })),
        (r.CSSStyleSheet.prototype.addRule = function (c, h, f = this.cssRules.length) {
          const p = `${c} { ${h} }`;
          return r.CSSStyleSheet.prototype.insertRule.apply(this, [p, f]);
        });
      const o = r.CSSStyleSheet.prototype.deleteRule;
      (r.CSSStyleSheet.prototype.deleteRule = new Proxy(o, {
        apply: _((c, h, f) => {
          const [p] = f,
            { id: g, styleId: m } = ve(h, e, t.styleMirror);
          return (
            ((g && g !== -1) || (m && m !== -1)) && s({ id: g, styleId: m, removes: [{ index: p }] }), c.apply(h, f)
          );
        }),
      })),
        (r.CSSStyleSheet.prototype.removeRule = function (c) {
          return r.CSSStyleSheet.prototype.deleteRule.apply(this, [c]);
        });
      let n;
      r.CSSStyleSheet.prototype.replace &&
        ((n = r.CSSStyleSheet.prototype.replace),
        (r.CSSStyleSheet.prototype.replace = new Proxy(n, {
          apply: _((c, h, f) => {
            const [p] = f,
              { id: g, styleId: m } = ve(h, e, t.styleMirror);
            return ((g && g !== -1) || (m && m !== -1)) && s({ id: g, styleId: m, replace: p }), c.apply(h, f);
          }),
        })));
      let a;
      r.CSSStyleSheet.prototype.replaceSync &&
        ((a = r.CSSStyleSheet.prototype.replaceSync),
        (r.CSSStyleSheet.prototype.replaceSync = new Proxy(a, {
          apply: _((c, h, f) => {
            const [p] = f,
              { id: g, styleId: m } = ve(h, e, t.styleMirror);
            return ((g && g !== -1) || (m && m !== -1)) && s({ id: g, styleId: m, replaceSync: p }), c.apply(h, f);
          }),
        })));
      const l = {};
      Qt("CSSGroupingRule")
        ? (l.CSSGroupingRule = r.CSSGroupingRule)
        : (Qt("CSSMediaRule") && (l.CSSMediaRule = r.CSSMediaRule),
          Qt("CSSConditionRule") && (l.CSSConditionRule = r.CSSConditionRule),
          Qt("CSSSupportsRule") && (l.CSSSupportsRule = r.CSSSupportsRule));
      const u = {};
      return (
        Object.entries(l).forEach(([c, h]) => {
          (u[c] = {
            insertRule: h.prototype.insertRule,
            deleteRule: h.prototype.deleteRule,
          }),
            (h.prototype.insertRule = new Proxy(u[c].insertRule, {
              apply: _((f, p, g) => {
                const [m, d] = g,
                  { id: y, styleId: S } = ve(p.parentStyleSheet, e, t.styleMirror);
                return (
                  ((y && y !== -1) || (S && S !== -1)) &&
                    s({
                      id: y,
                      styleId: S,
                      adds: [{ rule: m, index: [...Cr(p), d || 0] }],
                    }),
                  f.apply(p, g)
                );
              }),
            })),
            (h.prototype.deleteRule = new Proxy(u[c].deleteRule, {
              apply: _((f, p, g) => {
                const [m] = g,
                  { id: d, styleId: y } = ve(p.parentStyleSheet, e, t.styleMirror);
                return (
                  ((d && d !== -1) || (y && y !== -1)) &&
                    s({
                      id: d,
                      styleId: y,
                      removes: [{ index: [...Cr(p), m] }],
                    }),
                  f.apply(p, g)
                );
              }),
            }));
        }),
        _(() => {
          (r.CSSStyleSheet.prototype.insertRule = i),
            (r.CSSStyleSheet.prototype.deleteRule = o),
            n && (r.CSSStyleSheet.prototype.replace = n),
            a && (r.CSSStyleSheet.prototype.replaceSync = a),
            Object.entries(l).forEach(([c, h]) => {
              (h.prototype.insertRule = u[c].insertRule), (h.prototype.deleteRule = u[c].deleteRule);
            });
        })
      );
    }
    function $a({ mirror: s, stylesheetManager: e }, t) {
      var r, i, o;
      let n = null;
      t.nodeName === "#document" ? (n = s.getId(t)) : (n = s.getId(A.host(t)));
      const a =
          t.nodeName === "#document"
            ? (r = t.defaultView) == null
              ? void 0
              : r.Document
            : (o = (i = t.ownerDocument) == null ? void 0 : i.defaultView) == null
            ? void 0
            : o.ShadowRoot,
        l =
          a != null && a.prototype
            ? Object.getOwnPropertyDescriptor(a == null ? void 0 : a.prototype, "adoptedStyleSheets")
            : void 0;
      return n === null || n === -1 || !a || !l
        ? () => {}
        : (Object.defineProperty(t, "adoptedStyleSheets", {
            configurable: l.configurable,
            enumerable: l.enumerable,
            get() {
              var u;
              return (u = l.get) == null ? void 0 : u.call(this);
            },
            set(u) {
              var c;
              const h = (c = l.set) == null ? void 0 : c.call(this, u);
              if (n !== null && n !== -1)
                try {
                  e.adoptStyleSheets(u, n);
                } catch (f) {}
              return h;
            },
          }),
          _(() => {
            Object.defineProperty(t, "adoptedStyleSheets", {
              configurable: l.configurable,
              enumerable: l.enumerable,
              get: l.get,
              set: l.set,
            });
          }));
    }
    function Rd({ styleDeclarationCb: s, mirror: e, ignoreCSSAttributes: t, stylesheetManager: r }, { win: i }) {
      const o = i.CSSStyleDeclaration.prototype.setProperty;
      i.CSSStyleDeclaration.prototype.setProperty = new Proxy(o, {
        apply: _((a, l, u) => {
          var c;
          const [h, f, p] = u;
          if (t.has(h)) return o.apply(l, [h, f, p]);
          const { id: g, styleId: m } = ve((c = l.parentRule) == null ? void 0 : c.parentStyleSheet, e, r.styleMirror);
          return (
            ((g && g !== -1) || (m && m !== -1)) &&
              s({
                id: g,
                styleId: m,
                set: { property: h, value: f, priority: p },
                index: Cr(l.parentRule),
              }),
            a.apply(l, u)
          );
        }),
      });
      const n = i.CSSStyleDeclaration.prototype.removeProperty;
      return (
        (i.CSSStyleDeclaration.prototype.removeProperty = new Proxy(n, {
          apply: _((a, l, u) => {
            var c;
            const [h] = u;
            if (t.has(h)) return n.apply(l, [h]);
            const { id: f, styleId: p } = ve(
              (c = l.parentRule) == null ? void 0 : c.parentStyleSheet,
              e,
              r.styleMirror,
            );
            return (
              ((f && f !== -1) || (p && p !== -1)) &&
                s({
                  id: f,
                  styleId: p,
                  remove: { property: h },
                  index: Cr(l.parentRule),
                }),
              a.apply(l, u)
            );
          }),
        })),
        _(() => {
          (i.CSSStyleDeclaration.prototype.setProperty = o), (i.CSSStyleDeclaration.prototype.removeProperty = n);
        })
      );
    }
    function Nd({ mediaInteractionCb: s, blockClass: e, blockSelector: t, mirror: r, sampling: i, doc: o }) {
      const n = _((l) =>
          et(
            _((u) => {
              const c = Rt(u);
              if (!c || re(c, e, t, !0)) return;
              const { currentTime: h, volume: f, muted: p, playbackRate: g, loop: m } = c;
              s({
                type: l,
                id: r.getId(c),
                currentTime: h,
                volume: f,
                muted: p,
                playbackRate: g,
                loop: m,
              });
            }),
            i.media || 500,
          ),
        ),
        a = [
          te("play", n(Ce.Play), o),
          te("pause", n(Ce.Pause), o),
          te("seeked", n(Ce.Seeked), o),
          te("volumechange", n(Ce.VolumeChange), o),
          te("ratechange", n(Ce.RateChange), o),
        ];
      return _(() => {
        a.forEach((l) => l());
      });
    }
    function Ad({ fontCb: s, doc: e }) {
      const t = e.defaultView;
      if (!t) return () => {};
      const r = [],
        i = new WeakMap(),
        o = t.FontFace;
      t.FontFace = function (l, u, c) {
        const h = new o(l, u, c);
        return (
          i.set(h, {
            family: l,
            buffer: typeof u != "string",
            descriptors: c,
            fontSource: typeof u == "string" ? u : JSON.stringify(Array.from(new Uint8Array(u))),
          }),
          h
        );
      };
      const n = $e(e.fonts, "add", function (a) {
        return function (l) {
          return (
            setTimeout(
              _(() => {
                const u = i.get(l);
                u && (s(u), i.delete(l));
              }),
              0,
            ),
            a.apply(this, [l])
          );
        };
      });
      return (
        r.push(() => {
          t.FontFace = o;
        }),
        r.push(n),
        _(() => {
          r.forEach((a) => a());
        })
      );
    }
    function Od(s) {
      const { doc: e, mirror: t, blockClass: r, blockSelector: i, selectionCb: o } = s;
      let n = !0;
      const a = _(() => {
        const l = e.getSelection();
        if (!l || (n && l != null && l.isCollapsed)) return;
        n = l.isCollapsed || !1;
        const u = [],
          c = l.rangeCount || 0;
        for (let h = 0; h < c; h++) {
          const f = l.getRangeAt(h),
            { startContainer: p, startOffset: g, endContainer: m, endOffset: d } = f;
          re(p, r, i, !0) ||
            re(m, r, i, !0) ||
            u.push({
              start: t.getId(p),
              startOffset: g,
              end: t.getId(m),
              endOffset: d,
            });
        }
        o({ ranges: u });
      });
      return a(), te("selectionchange", a);
    }
    function Dd({ doc: s, customElementCb: e }) {
      const t = s.defaultView;
      return !t || !t.customElements
        ? () => {}
        : $e(t.customElements, "define", function (i) {
            return function (o, n, a) {
              try {
                e({ define: { name: o } });
              } catch (l) {
                console.warn(`Custom element callback failed for ${o}`);
              }
              return i.apply(this, [o, n, a]);
            };
          });
    }
    function Td(s, e) {
      const {
        mutationCb: t,
        mousemoveCb: r,
        mouseInteractionCb: i,
        scrollCb: o,
        viewportResizeCb: n,
        inputCb: a,
        mediaInteractionCb: l,
        styleSheetRuleCb: u,
        styleDeclarationCb: c,
        canvasMutationCb: h,
        fontCb: f,
        selectionCb: p,
        customElementCb: g,
      } = s;
      (s.mutationCb = (...m) => {
        e.mutation && e.mutation(...m), t(...m);
      }),
        (s.mousemoveCb = (...m) => {
          e.mousemove && e.mousemove(...m), r(...m);
        }),
        (s.mouseInteractionCb = (...m) => {
          e.mouseInteraction && e.mouseInteraction(...m), i(...m);
        }),
        (s.scrollCb = (...m) => {
          e.scroll && e.scroll(...m), o(...m);
        }),
        (s.viewportResizeCb = (...m) => {
          e.viewportResize && e.viewportResize(...m), n(...m);
        }),
        (s.inputCb = (...m) => {
          e.input && e.input(...m), a(...m);
        }),
        (s.mediaInteractionCb = (...m) => {
          e.mediaInteaction && e.mediaInteaction(...m), l(...m);
        }),
        (s.styleSheetRuleCb = (...m) => {
          e.styleSheetRule && e.styleSheetRule(...m), u(...m);
        }),
        (s.styleDeclarationCb = (...m) => {
          e.styleDeclaration && e.styleDeclaration(...m), c(...m);
        }),
        (s.canvasMutationCb = (...m) => {
          e.canvasMutation && e.canvasMutation(...m), h(...m);
        }),
        (s.fontCb = (...m) => {
          e.font && e.font(...m), f(...m);
        }),
        (s.selectionCb = (...m) => {
          e.selection && e.selection(...m), p(...m);
        }),
        (s.customElementCb = (...m) => {
          e.customElement && e.customElement(...m), g(...m);
        });
    }
    function _d(s, e = {}) {
      const t = s.doc.defaultView;
      if (!t) return () => {};
      Td(s, e);
      let r;
      s.recordDOM && (r = _a(s, s.doc));
      const i = vd(s),
        o = Cd(s),
        n = ka(s),
        a = Ed(s, { win: t }),
        l = xd(s),
        u = Nd(s);
      let c = () => {},
        h = () => {},
        f = () => {},
        p = () => {};
      s.recordDOM &&
        ((c = Md(s, { win: t })), (h = $a(s, s.doc)), (f = Rd(s, { win: t })), s.collectFonts && (p = Ad(s)));
      const g = Od(s),
        m = Dd(s),
        d = [];
      for (const y of s.plugins) d.push(y.observer(y.callback, t, y.options));
      return _(() => {
        Te.forEach((y) => y.reset()),
          r == null || r.disconnect(),
          i(),
          o(),
          n(),
          a(),
          l(),
          u(),
          c(),
          h(),
          f(),
          p(),
          g(),
          m(),
          d.forEach((y) => y());
      });
    }
    function Kt(s) {
      return typeof window[s] != "undefined";
    }
    function Qt(s) {
      return !!(
        typeof window[s] != "undefined" &&
        window[s].prototype &&
        "insertRule" in window[s].prototype &&
        "deleteRule" in window[s].prototype
      );
    }
    class An {
      constructor(e) {
        b(this, "iframeIdToRemoteIdMap", new WeakMap()),
          b(this, "iframeRemoteIdToIdMap", new WeakMap()),
          (this.generateIdFn = e);
      }
      getId(e, t, r, i) {
        const o = r || this.getIdToRemoteIdMap(e),
          n = i || this.getRemoteIdToIdMap(e);
        let a = o.get(t);
        return a || ((a = this.generateIdFn()), o.set(t, a), n.set(a, t)), a;
      }
      getIds(e, t) {
        const r = this.getIdToRemoteIdMap(e),
          i = this.getRemoteIdToIdMap(e);
        return t.map((o) => this.getId(e, o, r, i));
      }
      getRemoteId(e, t, r) {
        const i = r || this.getRemoteIdToIdMap(e);
        if (typeof t != "number") return t;
        const o = i.get(t);
        return o || -1;
      }
      getRemoteIds(e, t) {
        const r = this.getRemoteIdToIdMap(e);
        return t.map((i) => this.getRemoteId(e, i, r));
      }
      reset(e) {
        if (!e) {
          (this.iframeIdToRemoteIdMap = new WeakMap()), (this.iframeRemoteIdToIdMap = new WeakMap());
          return;
        }
        this.iframeIdToRemoteIdMap.delete(e), this.iframeRemoteIdToIdMap.delete(e);
      }
      getIdToRemoteIdMap(e) {
        let t = this.iframeIdToRemoteIdMap.get(e);
        return t || ((t = new Map()), this.iframeIdToRemoteIdMap.set(e, t)), t;
      }
      getRemoteIdToIdMap(e) {
        let t = this.iframeRemoteIdToIdMap.get(e);
        return t || ((t = new Map()), this.iframeRemoteIdToIdMap.set(e, t)), t;
      }
    }
    class kd {
      constructor(e) {
        b(this, "iframes", new WeakMap()),
          b(this, "crossOriginIframeMap", new WeakMap()),
          b(this, "crossOriginIframeMirror", new An(Hn)),
          b(this, "crossOriginIframeStyleMirror"),
          b(this, "crossOriginIframeRootIdMap", new WeakMap()),
          b(this, "mirror"),
          b(this, "mutationCb"),
          b(this, "wrappedEmit"),
          b(this, "loadListener"),
          b(this, "stylesheetManager"),
          b(this, "recordCrossOriginIframes"),
          (this.mutationCb = e.mutationCb),
          (this.wrappedEmit = e.wrappedEmit),
          (this.stylesheetManager = e.stylesheetManager),
          (this.recordCrossOriginIframes = e.recordCrossOriginIframes),
          (this.crossOriginIframeStyleMirror = new An(
            this.stylesheetManager.styleMirror.generateId.bind(this.stylesheetManager.styleMirror),
          )),
          (this.mirror = e.mirror),
          this.recordCrossOriginIframes && window.addEventListener("message", this.handleMessage.bind(this));
      }
      addIframe(e) {
        this.iframes.set(e, !0), e.contentWindow && this.crossOriginIframeMap.set(e.contentWindow, e);
      }
      addLoadListener(e) {
        this.loadListener = e;
      }
      attachIframe(e, t) {
        var r, i;
        this.mutationCb({
          adds: [{ parentId: this.mirror.getId(e), nextId: null, node: t }],
          removes: [],
          texts: [],
          attributes: [],
          isAttachIframe: !0,
        }),
          this.recordCrossOriginIframes &&
            ((r = e.contentWindow) == null || r.addEventListener("message", this.handleMessage.bind(this))),
          (i = this.loadListener) == null || i.call(this, e),
          e.contentDocument &&
            e.contentDocument.adoptedStyleSheets &&
            e.contentDocument.adoptedStyleSheets.length > 0 &&
            this.stylesheetManager.adoptStyleSheets(
              e.contentDocument.adoptedStyleSheets,
              this.mirror.getId(e.contentDocument),
            );
      }
      handleMessage(e) {
        const t = e;
        if (t.data.type !== "rrweb" || t.origin !== t.data.origin || !e.source) return;
        const i = this.crossOriginIframeMap.get(e.source);
        if (!i) return;
        const o = this.transformCrossOriginEvent(i, t.data.event);
        o && this.wrappedEmit(o, t.data.isCheckout);
      }
      transformCrossOriginEvent(e, t) {
        var r;
        switch (t.type) {
          case I.FullSnapshot: {
            this.crossOriginIframeMirror.reset(e),
              this.crossOriginIframeStyleMirror.reset(e),
              this.replaceIdOnNode(t.data.node, e);
            const i = t.data.node.id;
            return (
              this.crossOriginIframeRootIdMap.set(e, i),
              this.patchRootIdOnNode(t.data.node, i),
              {
                timestamp: t.timestamp,
                type: I.IncrementalSnapshot,
                data: {
                  source: E.Mutation,
                  adds: [
                    {
                      parentId: this.mirror.getId(e),
                      nextId: null,
                      node: t.data.node,
                    },
                  ],
                  removes: [],
                  texts: [],
                  attributes: [],
                  isAttachIframe: !0,
                },
              }
            );
          }
          case I.Meta:
          case I.Load:
          case I.DomContentLoaded:
            return !1;
          case I.Plugin:
            return t;
          case I.Custom:
            return this.replaceIds(t.data.payload, e, ["id", "parentId", "previousId", "nextId"]), t;
          case I.IncrementalSnapshot:
            switch (t.data.source) {
              case E.Mutation:
                return (
                  t.data.adds.forEach((i) => {
                    this.replaceIds(i, e, ["parentId", "nextId", "previousId"]), this.replaceIdOnNode(i.node, e);
                    const o = this.crossOriginIframeRootIdMap.get(e);
                    o && this.patchRootIdOnNode(i.node, o);
                  }),
                  t.data.removes.forEach((i) => {
                    this.replaceIds(i, e, ["parentId", "id"]);
                  }),
                  t.data.attributes.forEach((i) => {
                    this.replaceIds(i, e, ["id"]);
                  }),
                  t.data.texts.forEach((i) => {
                    this.replaceIds(i, e, ["id"]);
                  }),
                  t
                );
              case E.Drag:
              case E.TouchMove:
              case E.MouseMove:
                return (
                  t.data.positions.forEach((i) => {
                    this.replaceIds(i, e, ["id"]);
                  }),
                  t
                );
              case E.ViewportResize:
                return !1;
              case E.MediaInteraction:
              case E.MouseInteraction:
              case E.Scroll:
              case E.CanvasMutation:
              case E.Input:
                return this.replaceIds(t.data, e, ["id"]), t;
              case E.StyleSheetRule:
              case E.StyleDeclaration:
                return this.replaceIds(t.data, e, ["id"]), this.replaceStyleIds(t.data, e, ["styleId"]), t;
              case E.Font:
                return t;
              case E.Selection:
                return (
                  t.data.ranges.forEach((i) => {
                    this.replaceIds(i, e, ["start", "end"]);
                  }),
                  t
                );
              case E.AdoptedStyleSheet:
                return (
                  this.replaceIds(t.data, e, ["id"]),
                  this.replaceStyleIds(t.data, e, ["styleIds"]),
                  (r = t.data.styles) == null ||
                    r.forEach((i) => {
                      this.replaceStyleIds(i, e, ["styleId"]);
                    }),
                  t
                );
            }
        }
        return !1;
      }
      replace(e, t, r, i) {
        for (const o of i)
          (!Array.isArray(t[o]) && typeof t[o] != "number") ||
            (Array.isArray(t[o]) ? (t[o] = e.getIds(r, t[o])) : (t[o] = e.getId(r, t[o])));
        return t;
      }
      replaceIds(e, t, r) {
        return this.replace(this.crossOriginIframeMirror, e, t, r);
      }
      replaceStyleIds(e, t, r) {
        return this.replace(this.crossOriginIframeStyleMirror, e, t, r);
      }
      replaceIdOnNode(e, t) {
        this.replaceIds(e, t, ["id", "rootId"]),
          "childNodes" in e &&
            e.childNodes.forEach((r) => {
              this.replaceIdOnNode(r, t);
            });
      }
      patchRootIdOnNode(e, t) {
        e.type !== M.Document && !e.rootId && (e.rootId = t),
          "childNodes" in e &&
            e.childNodes.forEach((r) => {
              this.patchRootIdOnNode(r, t);
            });
      }
    }
    class $d {
      constructor(e) {
        b(this, "shadowDoms", new WeakSet()),
          b(this, "mutationCb"),
          b(this, "scrollCb"),
          b(this, "bypassOptions"),
          b(this, "mirror"),
          b(this, "restoreHandlers", []),
          (this.mutationCb = e.mutationCb),
          (this.scrollCb = e.scrollCb),
          (this.bypassOptions = e.bypassOptions),
          (this.mirror = e.mirror),
          this.init();
      }
      init() {
        this.reset(), this.patchAttachShadow(Element, document);
      }
      addShadowRoot(e, t) {
        if (!ut(e) || this.shadowDoms.has(e)) return;
        this.shadowDoms.add(e);
        const r = _a(
          Q(R({}, this.bypassOptions), {
            doc: t,
            mutationCb: this.mutationCb,
            mirror: this.mirror,
            shadowDomManager: this,
          }),
          e,
        );
        this.restoreHandlers.push(() => r.disconnect()),
          this.restoreHandlers.push(
            ka(
              Q(R({}, this.bypassOptions), {
                scrollCb: this.scrollCb,
                doc: e,
                mirror: this.mirror,
              }),
            ),
          ),
          setTimeout(() => {
            e.adoptedStyleSheets &&
              e.adoptedStyleSheets.length > 0 &&
              this.bypassOptions.stylesheetManager.adoptStyleSheets(e.adoptedStyleSheets, this.mirror.getId(A.host(e))),
              this.restoreHandlers.push(
                $a(
                  {
                    mirror: this.mirror,
                    stylesheetManager: this.bypassOptions.stylesheetManager,
                  },
                  e,
                ),
              );
          }, 0);
      }
      observeAttachShadow(e) {
        !e.contentWindow || !e.contentDocument || this.patchAttachShadow(e.contentWindow.Element, e.contentDocument);
      }
      patchAttachShadow(e, t) {
        const r = this;
        this.restoreHandlers.push(
          $e(e.prototype, "attachShadow", function (i) {
            return function (o) {
              const n = i.call(this, o),
                a = A.shadowRoot(this);
              return a && Ei(this) && r.addShadowRoot(a, t), n;
            };
          }),
        );
      }
      reset() {
        this.restoreHandlers.forEach((e) => {
          try {
            e();
          } catch (t) {}
        }),
          (this.restoreHandlers = []),
          (this.shadowDoms = new WeakSet());
      }
    }
    var je = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",
      at = typeof Uint8Array == "undefined" ? [] : new Uint8Array(256);
    for (var qt = 0; qt < je.length; qt++) at[je.charCodeAt(qt)] = qt;
    var Pd = function (s) {
        var e = new Uint8Array(s),
          t,
          r = e.length,
          i = "";
        for (t = 0; t < r; t += 3)
          (i += je[e[t] >> 2]),
            (i += je[((e[t] & 3) << 4) | (e[t + 1] >> 4)]),
            (i += je[((e[t + 1] & 15) << 2) | (e[t + 2] >> 6)]),
            (i += je[e[t + 2] & 63]);
        return (
          r % 3 === 2
            ? (i = i.substring(0, i.length - 1) + "=")
            : r % 3 === 1 && (i = i.substring(0, i.length - 2) + "=="),
          i
        );
      },
      Ld = function (s) {
        var e = s.length * 0.75,
          t = s.length,
          r,
          i = 0,
          o,
          n,
          a,
          l;
        s[s.length - 1] === "=" && (e--, s[s.length - 2] === "=" && e--);
        var u = new ArrayBuffer(e),
          c = new Uint8Array(u);
        for (r = 0; r < t; r += 4)
          (o = at[s.charCodeAt(r)]),
            (n = at[s.charCodeAt(r + 1)]),
            (a = at[s.charCodeAt(r + 2)]),
            (l = at[s.charCodeAt(r + 3)]),
            (c[i++] = (o << 2) | (n >> 4)),
            (c[i++] = ((n & 15) << 4) | (a >> 2)),
            (c[i++] = ((a & 3) << 6) | (l & 63));
        return u;
      };
    const On = new Map();
    function Fd(s, e) {
      let t = On.get(s);
      return t || ((t = new Map()), On.set(s, t)), t.has(e) || t.set(e, []), t.get(e);
    }
    const Pa = (s, e, t) => {
      if (!s || !(Fa(s, e) || typeof s == "object")) return;
      const r = s.constructor.name,
        i = Fd(t, r);
      let o = i.indexOf(s);
      return o === -1 && ((o = i.length), i.push(s)), o;
    };
    function or(s, e, t) {
      if (s instanceof Array) return s.map((r) => or(r, e, t));
      if (s === null) return s;
      if (
        s instanceof Float32Array ||
        s instanceof Float64Array ||
        s instanceof Int32Array ||
        s instanceof Uint32Array ||
        s instanceof Uint8Array ||
        s instanceof Uint16Array ||
        s instanceof Int16Array ||
        s instanceof Int8Array ||
        s instanceof Uint8ClampedArray
      )
        return { rr_type: s.constructor.name, args: [Object.values(s)] };
      if (s instanceof ArrayBuffer) {
        const r = s.constructor.name,
          i = Pd(s);
        return { rr_type: r, base64: i };
      } else {
        if (s instanceof DataView)
          return {
            rr_type: s.constructor.name,
            args: [or(s.buffer, e, t), s.byteOffset, s.byteLength],
          };
        if (s instanceof HTMLImageElement) {
          const r = s.constructor.name,
            { src: i } = s;
          return { rr_type: r, src: i };
        } else if (s instanceof HTMLCanvasElement) {
          const r = "HTMLImageElement",
            i = s.toDataURL();
          return { rr_type: r, src: i };
        } else {
          if (s instanceof ImageData)
            return {
              rr_type: s.constructor.name,
              args: [or(s.data, e, t), s.width, s.height],
            };
          if (Fa(s, e) || typeof s == "object") {
            const r = s.constructor.name,
              i = Pa(s, e, t);
            return { rr_type: r, index: i };
          }
        }
      }
      return s;
    }
    const La = (s, e, t) => s.map((r) => or(r, e, t)),
      Fa = (s, e) =>
        !![
          "WebGLActiveInfo",
          "WebGLBuffer",
          "WebGLFramebuffer",
          "WebGLProgram",
          "WebGLRenderbuffer",
          "WebGLShader",
          "WebGLShaderPrecisionFormat",
          "WebGLTexture",
          "WebGLUniformLocation",
          "WebGLVertexArrayObject",
          "WebGLVertexArrayObjectOES",
        ]
          .filter((i) => typeof e[i] == "function")
          .find((i) => s instanceof e[i]);
    function Bd(s, e, t, r) {
      const i = [],
        o = Object.getOwnPropertyNames(e.CanvasRenderingContext2D.prototype);
      for (const n of o)
        try {
          if (typeof e.CanvasRenderingContext2D.prototype[n] != "function") continue;
          const a = $e(e.CanvasRenderingContext2D.prototype, n, function (l) {
            return function (...u) {
              return (
                re(this.canvas, t, r, !0) ||
                  setTimeout(() => {
                    const c = La(u, e, this);
                    s(this.canvas, { type: Se["2D"], property: n, args: c });
                  }, 0),
                l.apply(this, u)
              );
            };
          });
          i.push(a);
        } catch (a) {
          const l = Mt(e.CanvasRenderingContext2D.prototype, n, {
            set(u) {
              s(this.canvas, {
                type: Se["2D"],
                property: n,
                args: [u],
                setter: !0,
              });
            },
          });
          i.push(l);
        }
      return () => {
        i.forEach((n) => n());
      };
    }
    function Ud(s) {
      return s === "experimental-webgl" ? "webgl" : s;
    }
    function Dn(s, e, t, r) {
      const i = [];
      try {
        const o = $e(s.HTMLCanvasElement.prototype, "getContext", function (n) {
          return function (a, ...l) {
            if (!re(this, e, t, !0)) {
              const u = Ud(a);
              if (("__context" in this || (this.__context = u), r && ["webgl", "webgl2"].includes(u)))
                if (l[0] && typeof l[0] == "object") {
                  const c = l[0];
                  c.preserveDrawingBuffer || (c.preserveDrawingBuffer = !0);
                } else l.splice(0, 1, { preserveDrawingBuffer: !0 });
            }
            return n.apply(this, [a, ...l]);
          };
        });
        i.push(o);
      } catch (o) {
        console.error("failed to patch HTMLCanvasElement.prototype.getContext");
      }
      return () => {
        i.forEach((o) => o());
      };
    }
    function Tn(s, e, t, r, i, o) {
      const n = [],
        a = Object.getOwnPropertyNames(s);
      for (const l of a)
        if (!["isContextLost", "canvas", "drawingBufferWidth", "drawingBufferHeight"].includes(l))
          try {
            if (typeof s[l] != "function") continue;
            const u = $e(s, l, function (c) {
              return function (...h) {
                const f = c.apply(this, h);
                if ((Pa(f, o, this), "tagName" in this.canvas && !re(this.canvas, r, i, !0))) {
                  const p = La(h, o, this),
                    g = { type: e, property: l, args: p };
                  t(this.canvas, g);
                }
                return f;
              };
            });
            n.push(u);
          } catch (u) {
            const c = Mt(s, l, {
              set(h) {
                t(this.canvas, { type: e, property: l, args: [h], setter: !0 });
              },
            });
            n.push(c);
          }
      return n;
    }
    function Wd(s, e, t, r) {
      const i = [];
      return (
        i.push(...Tn(e.WebGLRenderingContext.prototype, Se.WebGL, s, t, r, e)),
        typeof e.WebGL2RenderingContext != "undefined" &&
          i.push(...Tn(e.WebGL2RenderingContext.prototype, Se.WebGL2, s, t, r, e)),
        () => {
          i.forEach((o) => o());
        }
      );
    }
    const Ba =
        "KGZ1bmN0aW9uKCkgewogICJ1c2Ugc3RyaWN0IjsKICB2YXIgY2hhcnMgPSAiQUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5ejAxMjM0NTY3ODkrLyI7CiAgdmFyIGxvb2t1cCA9IHR5cGVvZiBVaW50OEFycmF5ID09PSAidW5kZWZpbmVkIiA/IFtdIDogbmV3IFVpbnQ4QXJyYXkoMjU2KTsKICBmb3IgKHZhciBpID0gMDsgaSA8IGNoYXJzLmxlbmd0aDsgaSsrKSB7CiAgICBsb29rdXBbY2hhcnMuY2hhckNvZGVBdChpKV0gPSBpOwogIH0KICB2YXIgZW5jb2RlID0gZnVuY3Rpb24oYXJyYXlidWZmZXIpIHsKICAgIHZhciBieXRlcyA9IG5ldyBVaW50OEFycmF5KGFycmF5YnVmZmVyKSwgaTIsIGxlbiA9IGJ5dGVzLmxlbmd0aCwgYmFzZTY0ID0gIiI7CiAgICBmb3IgKGkyID0gMDsgaTIgPCBsZW47IGkyICs9IDMpIHsKICAgICAgYmFzZTY0ICs9IGNoYXJzW2J5dGVzW2kyXSA+PiAyXTsKICAgICAgYmFzZTY0ICs9IGNoYXJzWyhieXRlc1tpMl0gJiAzKSA8PCA0IHwgYnl0ZXNbaTIgKyAxXSA+PiA0XTsKICAgICAgYmFzZTY0ICs9IGNoYXJzWyhieXRlc1tpMiArIDFdICYgMTUpIDw8IDIgfCBieXRlc1tpMiArIDJdID4+IDZdOwogICAgICBiYXNlNjQgKz0gY2hhcnNbYnl0ZXNbaTIgKyAyXSAmIDYzXTsKICAgIH0KICAgIGlmIChsZW4gJSAzID09PSAyKSB7CiAgICAgIGJhc2U2NCA9IGJhc2U2NC5zdWJzdHJpbmcoMCwgYmFzZTY0Lmxlbmd0aCAtIDEpICsgIj0iOwogICAgfSBlbHNlIGlmIChsZW4gJSAzID09PSAxKSB7CiAgICAgIGJhc2U2NCA9IGJhc2U2NC5zdWJzdHJpbmcoMCwgYmFzZTY0Lmxlbmd0aCAtIDIpICsgIj09IjsKICAgIH0KICAgIHJldHVybiBiYXNlNjQ7CiAgfTsKICBjb25zdCBsYXN0QmxvYk1hcCA9IC8qIEBfX1BVUkVfXyAqLyBuZXcgTWFwKCk7CiAgY29uc3QgdHJhbnNwYXJlbnRCbG9iTWFwID0gLyogQF9fUFVSRV9fICovIG5ldyBNYXAoKTsKICBhc3luYyBmdW5jdGlvbiBnZXRUcmFuc3BhcmVudEJsb2JGb3Iod2lkdGgsIGhlaWdodCwgZGF0YVVSTE9wdGlvbnMpIHsKICAgIGNvbnN0IGlkID0gYCR7d2lkdGh9LSR7aGVpZ2h0fWA7CiAgICBpZiAoIk9mZnNjcmVlbkNhbnZhcyIgaW4gZ2xvYmFsVGhpcykgewogICAgICBpZiAodHJhbnNwYXJlbnRCbG9iTWFwLmhhcyhpZCkpIHJldHVybiB0cmFuc3BhcmVudEJsb2JNYXAuZ2V0KGlkKTsKICAgICAgY29uc3Qgb2Zmc2NyZWVuID0gbmV3IE9mZnNjcmVlbkNhbnZhcyh3aWR0aCwgaGVpZ2h0KTsKICAgICAgb2Zmc2NyZWVuLmdldENvbnRleHQoIjJkIik7CiAgICAgIGNvbnN0IGJsb2IgPSBhd2FpdCBvZmZzY3JlZW4uY29udmVydFRvQmxvYihkYXRhVVJMT3B0aW9ucyk7CiAgICAgIGNvbnN0IGFycmF5QnVmZmVyID0gYXdhaXQgYmxvYi5hcnJheUJ1ZmZlcigpOwogICAgICBjb25zdCBiYXNlNjQgPSBlbmNvZGUoYXJyYXlCdWZmZXIpOwogICAgICB0cmFuc3BhcmVudEJsb2JNYXAuc2V0KGlkLCBiYXNlNjQpOwogICAgICByZXR1cm4gYmFzZTY0OwogICAgfSBlbHNlIHsKICAgICAgcmV0dXJuICIiOwogICAgfQogIH0KICBjb25zdCB3b3JrZXIgPSBzZWxmOwogIHdvcmtlci5vbm1lc3NhZ2UgPSBhc3luYyBmdW5jdGlvbihlKSB7CiAgICBpZiAoIk9mZnNjcmVlbkNhbnZhcyIgaW4gZ2xvYmFsVGhpcykgewogICAgICBjb25zdCB7IGlkLCBiaXRtYXAsIHdpZHRoLCBoZWlnaHQsIGRhdGFVUkxPcHRpb25zIH0gPSBlLmRhdGE7CiAgICAgIGNvbnN0IHRyYW5zcGFyZW50QmFzZTY0ID0gZ2V0VHJhbnNwYXJlbnRCbG9iRm9yKAogICAgICAgIHdpZHRoLAogICAgICAgIGhlaWdodCwKICAgICAgICBkYXRhVVJMT3B0aW9ucwogICAgICApOwogICAgICBjb25zdCBvZmZzY3JlZW4gPSBuZXcgT2Zmc2NyZWVuQ2FudmFzKHdpZHRoLCBoZWlnaHQpOwogICAgICBjb25zdCBjdHggPSBvZmZzY3JlZW4uZ2V0Q29udGV4dCgiMmQiKTsKICAgICAgY3R4LmRyYXdJbWFnZShiaXRtYXAsIDAsIDApOwogICAgICBiaXRtYXAuY2xvc2UoKTsKICAgICAgY29uc3QgYmxvYiA9IGF3YWl0IG9mZnNjcmVlbi5jb252ZXJ0VG9CbG9iKGRhdGFVUkxPcHRpb25zKTsKICAgICAgY29uc3QgdHlwZSA9IGJsb2IudHlwZTsKICAgICAgY29uc3QgYXJyYXlCdWZmZXIgPSBhd2FpdCBibG9iLmFycmF5QnVmZmVyKCk7CiAgICAgIGNvbnN0IGJhc2U2NCA9IGVuY29kZShhcnJheUJ1ZmZlcik7CiAgICAgIGlmICghbGFzdEJsb2JNYXAuaGFzKGlkKSAmJiBhd2FpdCB0cmFuc3BhcmVudEJhc2U2NCA9PT0gYmFzZTY0KSB7CiAgICAgICAgbGFzdEJsb2JNYXAuc2V0KGlkLCBiYXNlNjQpOwogICAgICAgIHJldHVybiB3b3JrZXIucG9zdE1lc3NhZ2UoeyBpZCB9KTsKICAgICAgfQogICAgICBpZiAobGFzdEJsb2JNYXAuZ2V0KGlkKSA9PT0gYmFzZTY0KSByZXR1cm4gd29ya2VyLnBvc3RNZXNzYWdlKHsgaWQgfSk7CiAgICAgIHdvcmtlci5wb3N0TWVzc2FnZSh7CiAgICAgICAgaWQsCiAgICAgICAgdHlwZSwKICAgICAgICBiYXNlNjQsCiAgICAgICAgd2lkdGgsCiAgICAgICAgaGVpZ2h0CiAgICAgIH0pOwogICAgICBsYXN0QmxvYk1hcC5zZXQoaWQsIGJhc2U2NCk7CiAgICB9IGVsc2UgewogICAgICByZXR1cm4gd29ya2VyLnBvc3RNZXNzYWdlKHsgaWQ6IGUuZGF0YS5pZCB9KTsKICAgIH0KICB9Owp9KSgpOwovLyMgc291cmNlTWFwcGluZ1VSTD1pbWFnZS1iaXRtYXAtZGF0YS11cmwtd29ya2VyLUlKcEM3Z19iLmpzLm1hcAo=",
      zd = (s) => Uint8Array.from(atob(s), (e) => e.charCodeAt(0)),
      _n = typeof window != "undefined" && window.Blob && new Blob([zd(Ba)], { type: "text/javascript;charset=utf-8" });
    function Vd(s) {
      let e;
      try {
        if (((e = _n && (window.URL || window.webkitURL).createObjectURL(_n)), !e)) throw "";
        const t = new Worker(e, { name: s == null ? void 0 : s.name });
        return (
          t.addEventListener("error", () => {
            (window.URL || window.webkitURL).revokeObjectURL(e);
          }),
          t
        );
      } catch (t) {
        return new Worker("data:text/javascript;base64," + Ba, {
          name: s == null ? void 0 : s.name,
        });
      } finally {
        e && (window.URL || window.webkitURL).revokeObjectURL(e);
      }
    }
    class Gd {
      constructor(e) {
        b(this, "pendingCanvasMutations", new Map()),
          b(this, "rafStamps", { latestId: 0, invokeId: null }),
          b(this, "mirror"),
          b(this, "mutationCb"),
          b(this, "resetObservers"),
          b(this, "frozen", !1),
          b(this, "locked", !1),
          b(this, "processMutation", (l, u) => {
            ((this.rafStamps.invokeId && this.rafStamps.latestId !== this.rafStamps.invokeId) ||
              !this.rafStamps.invokeId) &&
              (this.rafStamps.invokeId = this.rafStamps.latestId),
              this.pendingCanvasMutations.has(l) || this.pendingCanvasMutations.set(l, []),
              this.pendingCanvasMutations.get(l).push(u);
          });
        const { sampling: t = "all", win: r, blockClass: i, blockSelector: o, recordCanvas: n, dataURLOptions: a } = e;
        (this.mutationCb = e.mutationCb),
          (this.mirror = e.mirror),
          n && t === "all" && this.initCanvasMutationObserver(r, i, o),
          n && typeof t == "number" && this.initCanvasFPSObserver(t, r, i, o, { dataURLOptions: a });
      }
      reset() {
        this.pendingCanvasMutations.clear(), this.resetObservers && this.resetObservers();
      }
      freeze() {
        this.frozen = !0;
      }
      unfreeze() {
        this.frozen = !1;
      }
      lock() {
        this.locked = !0;
      }
      unlock() {
        this.locked = !1;
      }
      initCanvasFPSObserver(e, t, r, i, o) {
        const n = Dn(t, r, i, !0),
          a = new Map(),
          l = new Vd();
        l.onmessage = (g) => {
          const { id: m } = g.data;
          if ((a.set(m, !1), !("base64" in g.data))) return;
          const { base64: d, type: y, width: S, height: w } = g.data;
          this.mutationCb({
            id: m,
            type: Se["2D"],
            commands: [
              { property: "clearRect", args: [0, 0, S, w] },
              {
                property: "drawImage",
                args: [
                  {
                    rr_type: "ImageBitmap",
                    args: [
                      {
                        rr_type: "Blob",
                        data: [{ rr_type: "ArrayBuffer", base64: d }],
                        type: y,
                      },
                    ],
                  },
                  0,
                  0,
                ],
              },
            ],
          });
        };
        const u = 1e3 / e;
        let c = 0,
          h;
        const f = () => {
            const g = [];
            return (
              t.document.querySelectorAll("canvas").forEach((m) => {
                re(m, r, i, !0) || g.push(m);
              }),
              g
            );
          },
          p = (g) => {
            if (c && g - c < u) {
              h = requestAnimationFrame(p);
              return;
            }
            (c = g),
              f().forEach(async (m) => {
                var d;
                const y = this.mirror.getId(m);
                if (a.get(y) || m.width === 0 || m.height === 0) return;
                if ((a.set(y, !0), ["webgl", "webgl2"].includes(m.__context))) {
                  const w = m.getContext(m.__context);
                  ((d = w == null ? void 0 : w.getContextAttributes()) == null ? void 0 : d.preserveDrawingBuffer) ===
                    !1 && w.clear(w.COLOR_BUFFER_BIT);
                }
                const S = await createImageBitmap(m);
                l.postMessage(
                  {
                    id: y,
                    bitmap: S,
                    width: m.width,
                    height: m.height,
                    dataURLOptions: o.dataURLOptions,
                  },
                  [S],
                );
              }),
              (h = requestAnimationFrame(p));
          };
        (h = requestAnimationFrame(p)),
          (this.resetObservers = () => {
            n(), cancelAnimationFrame(h);
          });
      }
      initCanvasMutationObserver(e, t, r) {
        this.startRAFTimestamping(), this.startPendingCanvasMutationFlusher();
        const i = Dn(e, t, r, !1),
          o = Bd(this.processMutation.bind(this), e, t, r),
          n = Wd(this.processMutation.bind(this), e, t, r);
        this.resetObservers = () => {
          i(), o(), n();
        };
      }
      startPendingCanvasMutationFlusher() {
        requestAnimationFrame(() => this.flushPendingCanvasMutations());
      }
      startRAFTimestamping() {
        const e = (t) => {
          (this.rafStamps.latestId = t), requestAnimationFrame(e);
        };
        requestAnimationFrame(e);
      }
      flushPendingCanvasMutations() {
        this.pendingCanvasMutations.forEach((e, t) => {
          const r = this.mirror.getId(t);
          this.flushPendingCanvasMutationFor(t, r);
        }),
          requestAnimationFrame(() => this.flushPendingCanvasMutations());
      }
      flushPendingCanvasMutationFor(e, t) {
        if (this.frozen || this.locked) return;
        const r = this.pendingCanvasMutations.get(e);
        if (!r || t === -1) return;
        const i = r.map((n) => {
            const u = n,
              { type: a } = u;
            return Le(u, ["type"]);
          }),
          { type: o } = r[0];
        this.mutationCb({ id: t, type: o, commands: i }), this.pendingCanvasMutations.delete(e);
      }
    }
    class jd {
      constructor(e) {
        b(this, "trackedLinkElements", new WeakSet()),
          b(this, "mutationCb"),
          b(this, "adoptedStyleSheetCb"),
          b(this, "styleMirror", new vi()),
          (this.mutationCb = e.mutationCb),
          (this.adoptedStyleSheetCb = e.adoptedStyleSheetCb);
      }
      attachLinkElement(e, t) {
        "_cssText" in t.attributes &&
          this.mutationCb({
            adds: [],
            removes: [],
            texts: [],
            attributes: [{ id: t.id, attributes: t.attributes }],
          }),
          this.trackLinkElement(e);
      }
      trackLinkElement(e) {
        this.trackedLinkElements.has(e) || (this.trackedLinkElements.add(e), this.trackStylesheetInLinkElement(e));
      }
      adoptStyleSheets(e, t) {
        if (e.length === 0) return;
        const r = { id: t, styleIds: [] },
          i = [];
        for (const o of e) {
          let n;
          this.styleMirror.has(o)
            ? (n = this.styleMirror.getId(o))
            : ((n = this.styleMirror.add(o)),
              i.push({
                styleId: n,
                rules: Array.from(o.rules || CSSRule, (a, l) => ({
                  rule: Gn(a, o.href),
                  index: l,
                })),
              })),
            r.styleIds.push(n);
        }
        i.length > 0 && (r.styles = i), this.adoptedStyleSheetCb(r);
      }
      reset() {
        this.styleMirror.reset(), (this.trackedLinkElements = new WeakSet());
      }
      trackStylesheetInLinkElement(e) {}
    }
    class Yd {
      constructor() {
        b(this, "nodeMap", new WeakMap()), b(this, "active", !1);
      }
      inOtherBuffer(e, t) {
        const r = this.nodeMap.get(e);
        return r && Array.from(r).some((i) => i !== t);
      }
      add(e, t) {
        this.active ||
          ((this.active = !0),
          requestAnimationFrame(() => {
            (this.nodeMap = new WeakMap()), (this.active = !1);
          })),
          this.nodeMap.set(e, (this.nodeMap.get(e) || new Set()).add(t));
      }
      destroy() {}
    }
    let X,
      ar,
      Qr,
      Er = !1;
    try {
      if (Array.from([1], (s) => s * 2)[0] !== 2) {
        const s = document.createElement("iframe");
        document.body.appendChild(s),
          (Array.from = ((Oi = s.contentWindow) == null ? void 0 : Oi.Array.from) || Array.from),
          document.body.removeChild(s);
      }
    } catch (s) {
      console.debug("Unable to override Array.from", s);
    }
    const le = jn();
    function Ne(s = {}) {
      const {
        emit: e,
        checkoutEveryNms: t,
        checkoutEveryNth: r,
        blockClass: i = "rr-block",
        blockSelector: o = null,
        ignoreClass: n = "rr-ignore",
        ignoreSelector: a = null,
        maskTextClass: l = "rr-mask",
        maskTextSelector: u = null,
        inlineStylesheet: c = !0,
        maskAllInputs: h,
        maskInputOptions: f,
        slimDOMOptions: p,
        maskInputFn: g,
        maskTextFn: m,
        hooks: d,
        packFn: y,
        sampling: S = {},
        dataURLOptions: w = {},
        mousemoveWait: v,
        recordDOM: x = !0,
        recordCanvas: N = !1,
        recordCrossOriginIframes: z = !1,
        recordAfter: D = s.recordAfter === "DOMContentLoaded" ? s.recordAfter : "load",
        userTriggeredOnInput: J = !1,
        collectFonts: K = !1,
        inlineImages: se = !1,
        plugins: T,
        keepIframeSrcFn: fe = () => !1,
        ignoreCSSAttributes: Ae = new Set([]),
        errorHandler: q,
      } = s;
      bd(q);
      const ie = z ? window.parent === window : !0;
      let U = !1;
      if (!ie)
        try {
          window.parent.document && (U = !1);
        } catch (P) {
          U = !0;
        }
      if (ie && !e) throw new Error("emit function is required");
      if (!ie && !U) return () => {};
      v !== void 0 && S.mousemove === void 0 && (S.mousemove = v), le.reset();
      const ne =
          h === !0
            ? {
                color: !0,
                date: !0,
                "datetime-local": !0,
                email: !0,
                month: !0,
                number: !0,
                range: !0,
                search: !0,
                tel: !0,
                text: !0,
                time: !0,
                url: !0,
                week: !0,
                textarea: !0,
                select: !0,
                password: !0,
              }
            : f !== void 0
            ? f
            : { password: !0 },
        Pe =
          p === !0 || p === "all"
            ? {
                script: !0,
                comment: !0,
                headFavicon: !0,
                headWhitespace: !0,
                headMetaSocial: !0,
                headMetaRobots: !0,
                headMetaHttpEquiv: !0,
                headMetaVerification: !0,
                headMetaAuthorship: p === "all",
                headMetaDescKeywords: p === "all",
                headTitleMutations: p === "all",
              }
            : p || {};
      yi();
      let rt,
        Lr = 0;
      const Ii = (P) => {
        for (const ae of T || []) ae.eventProcessor && (P = ae.eventProcessor(P));
        return y && !U && (P = y(P)), P;
      };
      X = (P, ae) => {
        var H;
        const Z = P;
        if (
          ((Z.timestamp = vt()),
          (H = Te[0]) != null &&
            H.isFrozen() &&
            Z.type !== I.FullSnapshot &&
            !(Z.type === I.IncrementalSnapshot && Z.data.source === E.Mutation) &&
            Te.forEach((de) => de.unfreeze()),
          ie)
        )
          e == null || e(Ii(Z), ae);
        else if (U) {
          const de = {
            type: "rrweb",
            event: Ii(Z),
            origin: window.location.origin,
            isCheckout: ae,
          };
          window.parent.postMessage(de, "*");
        }
        if (Z.type === I.FullSnapshot) (rt = Z), (Lr = 0);
        else if (Z.type === I.IncrementalSnapshot) {
          if (Z.data.source === E.Mutation && Z.data.isAttachIframe) return;
          Lr++;
          const de = r && Lr >= r,
            B = t && Z.timestamp - rt.timestamp > t;
          (de || B) && ar(!0);
        }
      };
      const Nt = (P) => {
          X({
            type: I.IncrementalSnapshot,
            data: R({ source: E.Mutation }, P),
          });
        },
        xi = (P) => X({ type: I.IncrementalSnapshot, data: R({ source: E.Scroll }, P) }),
        Mi = (P) =>
          X({
            type: I.IncrementalSnapshot,
            data: R({ source: E.CanvasMutation }, P),
          }),
        Ya = (P) =>
          X({
            type: I.IncrementalSnapshot,
            data: R({ source: E.AdoptedStyleSheet }, P),
          }),
        Oe = new jd({ mutationCb: Nt, adoptedStyleSheetCb: Ya }),
        De = new kd({
          mirror: le,
          mutationCb: Nt,
          stylesheetManager: Oe,
          recordCrossOriginIframes: z,
          wrappedEmit: X,
        });
      for (const P of T || [])
        P.getMirror &&
          P.getMirror({
            nodeMirror: le,
            crossOriginIframeMirror: De.crossOriginIframeMirror,
            crossOriginIframeStyleMirror: De.crossOriginIframeStyleMirror,
          });
      const Fr = new Yd();
      Qr = new Gd({
        recordCanvas: N,
        mutationCb: Mi,
        win: window,
        blockClass: i,
        blockSelector: o,
        mirror: le,
        sampling: S.canvas,
        dataURLOptions: w,
      });
      const At = new $d({
        mutationCb: Nt,
        scrollCb: xi,
        bypassOptions: {
          blockClass: i,
          blockSelector: o,
          maskTextClass: l,
          maskTextSelector: u,
          inlineStylesheet: c,
          maskInputOptions: ne,
          dataURLOptions: w,
          maskTextFn: m,
          maskInputFn: g,
          recordCanvas: N,
          inlineImages: se,
          sampling: S,
          slimDOMOptions: Pe,
          iframeManager: De,
          stylesheetManager: Oe,
          canvasManager: Qr,
          keepIframeSrcFn: fe,
          processedNodeManager: Fr,
        },
        mirror: le,
      });
      ar = (P = !1) => {
        if (!x) return;
        X(
          {
            type: I.Meta,
            data: { href: window.location.href, width: pi(), height: di() },
          },
          P,
        ),
          Oe.reset(),
          At.init(),
          Te.forEach((H) => H.lock());
        const ae = Bl(document, {
          mirror: le,
          blockClass: i,
          blockSelector: o,
          maskTextClass: l,
          maskTextSelector: u,
          inlineStylesheet: c,
          maskAllInputs: ne,
          maskTextFn: m,
          maskInputFn: g,
          slimDOM: Pe,
          dataURLOptions: w,
          recordCanvas: N,
          inlineImages: se,
          onSerialize: (H) => {
            He(H, le) && De.addIframe(H),
              bi(H, le) && Oe.trackLinkElement(H),
              Ee(H) && At.addShadowRoot(A.shadowRoot(H), document);
          },
          onIframeLoad: (H, Z) => {
            De.attachIframe(H, Z), At.observeAttachShadow(H);
          },
          onStylesheetLoad: (H, Z) => {
            Oe.attachLinkElement(H, Z);
          },
          keepIframeSrcFn: fe,
        });
        if (!ae) return console.warn("Failed to snapshot the document");
        X(
          {
            type: I.FullSnapshot,
            data: { node: ae, initialOffset: fi(window) },
          },
          P,
        ),
          Te.forEach((H) => H.unlock()),
          document.adoptedStyleSheets &&
            document.adoptedStyleSheets.length > 0 &&
            Oe.adoptStyleSheets(document.adoptedStyleSheets, le.getId(document));
      };
      try {
        const P = [],
          ae = (Z) => {
            var de;
            return _(_d)(
              {
                mutationCb: Nt,
                mousemoveCb: (B, Br) =>
                  X({
                    type: I.IncrementalSnapshot,
                    data: { source: Br, positions: B },
                  }),
                mouseInteractionCb: (B) =>
                  X({
                    type: I.IncrementalSnapshot,
                    data: R({ source: E.MouseInteraction }, B),
                  }),
                scrollCb: xi,
                viewportResizeCb: (B) =>
                  X({
                    type: I.IncrementalSnapshot,
                    data: R({ source: E.ViewportResize }, B),
                  }),
                inputCb: (B) =>
                  X({
                    type: I.IncrementalSnapshot,
                    data: R({ source: E.Input }, B),
                  }),
                mediaInteractionCb: (B) =>
                  X({
                    type: I.IncrementalSnapshot,
                    data: R({ source: E.MediaInteraction }, B),
                  }),
                styleSheetRuleCb: (B) =>
                  X({
                    type: I.IncrementalSnapshot,
                    data: R({ source: E.StyleSheetRule }, B),
                  }),
                styleDeclarationCb: (B) =>
                  X({
                    type: I.IncrementalSnapshot,
                    data: R({ source: E.StyleDeclaration }, B),
                  }),
                canvasMutationCb: Mi,
                fontCb: (B) =>
                  X({
                    type: I.IncrementalSnapshot,
                    data: R({ source: E.Font }, B),
                  }),
                selectionCb: (B) => {
                  X({
                    type: I.IncrementalSnapshot,
                    data: R({ source: E.Selection }, B),
                  });
                },
                customElementCb: (B) => {
                  X({
                    type: I.IncrementalSnapshot,
                    data: R({ source: E.CustomElement }, B),
                  });
                },
                blockClass: i,
                ignoreClass: n,
                ignoreSelector: a,
                maskTextClass: l,
                maskTextSelector: u,
                maskInputOptions: ne,
                inlineStylesheet: c,
                sampling: S,
                recordDOM: x,
                recordCanvas: N,
                inlineImages: se,
                userTriggeredOnInput: J,
                collectFonts: K,
                doc: Z,
                maskInputFn: g,
                maskTextFn: m,
                keepIframeSrcFn: fe,
                blockSelector: o,
                slimDOMOptions: Pe,
                dataURLOptions: w,
                mirror: le,
                iframeManager: De,
                stylesheetManager: Oe,
                shadowDomManager: At,
                processedNodeManager: Fr,
                canvasManager: Qr,
                ignoreCSSAttributes: Ae,
                plugins:
                  ((de = T == null ? void 0 : T.filter((B) => B.observer)) == null
                    ? void 0
                    : de.map((B) => ({
                        observer: B.observer,
                        options: B.options,
                        callback: (Br) =>
                          X({
                            type: I.Plugin,
                            data: { plugin: B.name, payload: Br },
                          }),
                      }))) || [],
              },
              d,
            );
          };
        De.addLoadListener((Z) => {
          try {
            P.push(ae(Z.contentDocument));
          } catch (de) {
            console.warn(de);
          }
        });
        const H = () => {
          ar(), P.push(ae(document)), (Er = !0);
        };
        return (
          document.readyState === "interactive" || document.readyState === "complete"
            ? H()
            : (P.push(
                te("DOMContentLoaded", () => {
                  X({ type: I.DomContentLoaded, data: {} }), D === "DOMContentLoaded" && H();
                }),
              ),
              P.push(
                te(
                  "load",
                  () => {
                    X({ type: I.Load, data: {} }), D === "load" && H();
                  },
                  window,
                ),
              )),
          () => {
            P.forEach((Z) => Z()), Fr.destroy(), (Er = !1), Sd();
          }
        );
      } catch (P) {
        console.warn(P);
      }
    }
    Ne.addCustomEvent = (s, e) => {
      if (!Er) throw new Error("please add custom event after start recording");
      X({ type: I.Custom, data: { tag: s, payload: e } });
    };
    Ne.freezePage = () => {
      Te.forEach((s) => s.freeze());
    };
    Ne.takeFullSnapshot = (s) => {
      if (!Er) throw new Error("please take full snapshot after start recording");
      ar(s);
    };
    Ne.mirror = le;
    function Ua(s) {
      return {
        all: (s = s || new Map()),
        on: function (e, t) {
          var r = s.get(e);
          r ? r.push(t) : s.set(e, [t]);
        },
        off: function (e, t) {
          var r = s.get(e);
          r && (t ? r.splice(r.indexOf(t) >>> 0, 1) : s.set(e, []));
        },
        emit: function (e, t) {
          var r = s.get(e);
          r &&
            r.slice().map(function (i) {
              i(t);
            }),
            (r = s.get("*")) &&
              r.slice().map(function (i) {
                i(e, t);
              });
        },
      };
    }
    const Hd = Object.freeze(
      Object.defineProperty({ __proto__: null, default: Ua }, Symbol.toStringTag, { value: "Module" }),
    );
    function Zd(s = window, e = document) {
      if ("scrollBehavior" in e.documentElement.style && s.__forceSmoothScrollPolyfill__ !== !0) return;
      const t = s.HTMLElement || s.Element,
        r = 468,
        i = {
          scroll: s.scroll || s.scrollTo,
          scrollBy: s.scrollBy,
          elementScroll: t.prototype.scroll || l,
          scrollIntoView: t.prototype.scrollIntoView,
        },
        o = s.performance && s.performance.now ? s.performance.now.bind(s.performance) : Date.now;
      function n(y) {
        const S = ["MSIE ", "Trident/", "Edge/"];
        return new RegExp(S.join("|")).test(y);
      }
      const a = n(s.navigator.userAgent) ? 1 : 0;
      function l(y, S) {
        (this.scrollLeft = y), (this.scrollTop = S);
      }
      function u(y) {
        return 0.5 * (1 - Math.cos(Math.PI * y));
      }
      function c(y) {
        if (
          y === null ||
          typeof y != "object" ||
          y.behavior === void 0 ||
          y.behavior === "auto" ||
          y.behavior === "instant"
        )
          return !0;
        if (typeof y == "object" && y.behavior === "smooth") return !1;
        throw new TypeError(
          "behavior member of ScrollOptions " + y.behavior + " is not a valid value for enumeration ScrollBehavior.",
        );
      }
      function h(y, S) {
        if (S === "Y") return y.clientHeight + a < y.scrollHeight;
        if (S === "X") return y.clientWidth + a < y.scrollWidth;
      }
      function f(y, S) {
        const w = s.getComputedStyle(y, null)["overflow" + S];
        return w === "auto" || w === "scroll";
      }
      function p(y) {
        const S = h(y, "Y") && f(y, "Y"),
          w = h(y, "X") && f(y, "X");
        return S || w;
      }
      function g(y) {
        for (; y !== e.body && p(y) === !1; ) y = y.parentNode || y.host;
        return y;
      }
      function m(y) {
        const S = o();
        let w,
          v,
          x,
          N = (S - y.startTime) / r;
        (N = N > 1 ? 1 : N),
          (w = u(N)),
          (v = y.startX + (y.x - y.startX) * w),
          (x = y.startY + (y.y - y.startY) * w),
          y.method.call(y.scrollable, v, x),
          (v !== y.x || x !== y.y) && s.requestAnimationFrame(m.bind(s, y));
      }
      function d(y, S, w) {
        let v, x, N, z;
        const D = o();
        y === e.body
          ? ((v = s), (x = s.scrollX || s.pageXOffset), (N = s.scrollY || s.pageYOffset), (z = i.scroll))
          : ((v = y), (x = y.scrollLeft), (N = y.scrollTop), (z = l)),
          m({
            scrollable: v,
            method: z,
            startTime: D,
            startX: x,
            startY: N,
            x: S,
            y: w,
          });
      }
      (s.scroll = s.scrollTo =
        function () {
          if (arguments[0] !== void 0) {
            if (c(arguments[0]) === !0) {
              i.scroll.call(
                s,
                arguments[0].left !== void 0
                  ? arguments[0].left
                  : typeof arguments[0] != "object"
                  ? arguments[0]
                  : s.scrollX || s.pageXOffset,
                arguments[0].top !== void 0
                  ? arguments[0].top
                  : arguments[1] !== void 0
                  ? arguments[1]
                  : s.scrollY || s.pageYOffset,
              );
              return;
            }
            d.call(
              s,
              e.body,
              arguments[0].left !== void 0 ? ~~arguments[0].left : s.scrollX || s.pageXOffset,
              arguments[0].top !== void 0 ? ~~arguments[0].top : s.scrollY || s.pageYOffset,
            );
          }
        }),
        (s.scrollBy = function () {
          if (arguments[0] !== void 0) {
            if (c(arguments[0])) {
              i.scrollBy.call(
                s,
                arguments[0].left !== void 0 ? arguments[0].left : typeof arguments[0] != "object" ? arguments[0] : 0,
                arguments[0].top !== void 0 ? arguments[0].top : arguments[1] !== void 0 ? arguments[1] : 0,
              );
              return;
            }
            d.call(
              s,
              e.body,
              ~~arguments[0].left + (s.scrollX || s.pageXOffset),
              ~~arguments[0].top + (s.scrollY || s.pageYOffset),
            );
          }
        }),
        (t.prototype.scroll = t.prototype.scrollTo =
          function () {
            if (arguments[0] === void 0) return;
            if (c(arguments[0]) === !0) {
              if (typeof arguments[0] == "number" && arguments[1] === void 0)
                throw new SyntaxError("Value could not be converted");
              i.elementScroll.call(
                this,
                arguments[0].left !== void 0
                  ? ~~arguments[0].left
                  : typeof arguments[0] != "object"
                  ? ~~arguments[0]
                  : this.scrollLeft,
                arguments[0].top !== void 0
                  ? ~~arguments[0].top
                  : arguments[1] !== void 0
                  ? ~~arguments[1]
                  : this.scrollTop,
              );
              return;
            }
            const y = arguments[0].left,
              S = arguments[0].top;
            d.call(
              this,
              this,
              typeof y == "undefined" ? this.scrollLeft : ~~y,
              typeof S == "undefined" ? this.scrollTop : ~~S,
            );
          }),
        (t.prototype.scrollBy = function () {
          if (arguments[0] !== void 0) {
            if (c(arguments[0]) === !0) {
              i.elementScroll.call(
                this,
                arguments[0].left !== void 0 ? ~~arguments[0].left + this.scrollLeft : ~~arguments[0] + this.scrollLeft,
                arguments[0].top !== void 0 ? ~~arguments[0].top + this.scrollTop : ~~arguments[1] + this.scrollTop,
              );
              return;
            }
            this.scroll({
              left: ~~arguments[0].left + this.scrollLeft,
              top: ~~arguments[0].top + this.scrollTop,
              behavior: arguments[0].behavior,
            });
          }
        }),
        (t.prototype.scrollIntoView = function () {
          if (c(arguments[0]) === !0) {
            i.scrollIntoView.call(this, arguments[0] === void 0 ? !0 : arguments[0]);
            return;
          }
          const y = g(this),
            S = y.getBoundingClientRect(),
            w = this.getBoundingClientRect();
          y !== e.body
            ? (d.call(this, y, y.scrollLeft + w.left - S.left, y.scrollTop + w.top - S.top),
              s.getComputedStyle(y).position !== "fixed" &&
                s.scrollBy({ left: S.left, top: S.top, behavior: "smooth" }))
            : s.scrollBy({ left: w.left, top: w.top, behavior: "smooth" });
        });
    }
    class Xd {
      constructor(e = [], t) {
        b(this, "timeOffset", 0),
          b(this, "speed"),
          b(this, "actions"),
          b(this, "raf", null),
          b(this, "lastTimestamp"),
          (this.actions = e),
          (this.speed = t.speed);
      }
      addAction(e) {
        const t = this.raf === !0;
        if (!this.actions.length || this.actions[this.actions.length - 1].delay <= e.delay) this.actions.push(e);
        else {
          const r = this.findActionIndex(e);
          this.actions.splice(r, 0, e);
        }
        t && (this.raf = requestAnimationFrame(this.rafCheck.bind(this)));
      }
      start() {
        (this.timeOffset = 0),
          (this.lastTimestamp = performance.now()),
          (this.raf = requestAnimationFrame(this.rafCheck.bind(this)));
      }
      rafCheck() {
        const e = performance.now();
        for (this.timeOffset += (e - this.lastTimestamp) * this.speed, this.lastTimestamp = e; this.actions.length; ) {
          const t = this.actions[0];
          if (this.timeOffset >= t.delay) this.actions.shift(), t.doAction();
          else break;
        }
        this.actions.length > 0 ? (this.raf = requestAnimationFrame(this.rafCheck.bind(this))) : (this.raf = !0);
      }
      clear() {
        this.raf && (this.raf !== !0 && cancelAnimationFrame(this.raf), (this.raf = null)), (this.actions.length = 0);
      }
      setSpeed(e) {
        this.speed = e;
      }
      isActive() {
        return this.raf !== null;
      }
      findActionIndex(e) {
        let t = 0,
          r = this.actions.length - 1;
        for (; t <= r; ) {
          const i = Math.floor((t + r) / 2);
          if (this.actions[i].delay < e.delay) t = i + 1;
          else if (this.actions[i].delay > e.delay) r = i - 1;
          else return i + 1;
        }
        return t;
      }
    }
    function kn(s, e) {
      if (
        s.type === I.IncrementalSnapshot &&
        s.data.source === E.MouseMove &&
        s.data.positions &&
        s.data.positions.length
      ) {
        const t = s.data.positions[0].timeOffset,
          r = s.timestamp + t;
        return (s.delay = r - e), r - e;
      }
      return (s.delay = s.timestamp - e), s.delay;
    }
    /*! *****************************************************************************
Copyright (c) Microsoft Corporation.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
***************************************************************************** */ function $n(s, e) {
      var t = typeof Symbol == "function" && s[Symbol.iterator];
      if (!t) return s;
      var r,
        i,
        o = t.call(s),
        n = [];
      try {
        for (; (e === void 0 || e-- > 0) && !(r = o.next()).done; ) n.push(r.value);
      } catch (a) {
        i = { error: a };
      } finally {
        try {
          r && !r.done && (t = o.return) && t.call(o);
        } finally {
          if (i) throw i.error;
        }
      }
      return n;
    }
    var Ye;
    (function (s) {
      (s[(s.NotStarted = 0)] = "NotStarted"), (s[(s.Running = 1)] = "Running"), (s[(s.Stopped = 2)] = "Stopped");
    })(Ye || (Ye = {}));
    var Wa = { type: "xstate.init" };
    function qr(s) {
      return s === void 0 ? [] : [].concat(s);
    }
    function We(s) {
      return { type: "xstate.assign", assignment: s };
    }
    function Pn(s, e) {
      return typeof (s = typeof s == "string" && e && e[s] ? e[s] : s) == "string"
        ? { type: s }
        : typeof s == "function"
        ? { type: s.name, exec: s }
        : s;
    }
    function Ir(s) {
      return function (e) {
        return s === e;
      };
    }
    function za(s) {
      return typeof s == "string" ? { type: s } : s;
    }
    function Ln(s, e) {
      return { value: s, context: e, actions: [], changed: !1, matches: Ir(s) };
    }
    function Fn(s, e, t) {
      var r = e,
        i = !1;
      return [
        s.filter(function (o) {
          if (o.type === "xstate.assign") {
            i = !0;
            var n = Object.assign({}, r);
            return (
              typeof o.assignment == "function"
                ? (n = o.assignment(r, t))
                : Object.keys(o.assignment).forEach(function (a) {
                    n[a] = typeof o.assignment[a] == "function" ? o.assignment[a](r, t) : o.assignment[a];
                  }),
              (r = n),
              !1
            );
          }
          return !0;
        }),
        r,
        i,
      ];
    }
    function Va(s, e) {
      e === void 0 && (e = {});
      var t = $n(
          Fn(
            qr(s.states[s.initial].entry).map(function (n) {
              return Pn(n, e.actions);
            }),
            s.context,
            Wa,
          ),
          2,
        ),
        r = t[0],
        i = t[1],
        o = {
          config: s,
          _options: e,
          initialState: {
            value: s.initial,
            actions: r,
            context: i,
            matches: Ir(s.initial),
          },
          transition: function (n, a) {
            var l,
              u,
              c = typeof n == "string" ? { value: n, context: s.context } : n,
              h = c.value,
              f = c.context,
              p = za(a),
              g = s.states[h];
            if (g.on) {
              var m = qr(g.on[p.type]);
              try {
                for (
                  var d = (function (U) {
                      var ne = typeof Symbol == "function" && Symbol.iterator,
                        Pe = ne && U[ne],
                        rt = 0;
                      if (Pe) return Pe.call(U);
                      if (U && typeof U.length == "number")
                        return {
                          next: function () {
                            return U && rt >= U.length && (U = void 0), { value: U && U[rt++], done: !U };
                          },
                        };
                      throw new TypeError(ne ? "Object is not iterable." : "Symbol.iterator is not defined.");
                    })(m),
                    y = d.next();
                  !y.done;
                  y = d.next()
                ) {
                  var S = y.value;
                  if (S === void 0) return Ln(h, f);
                  var w = typeof S == "string" ? { target: S } : S,
                    v = w.target,
                    x = w.actions,
                    N = x === void 0 ? [] : x,
                    z = w.cond,
                    D =
                      z === void 0
                        ? function () {
                            return !0;
                          }
                        : z,
                    J = v === void 0,
                    K = v != null ? v : h,
                    se = s.states[K];
                  if (D(f, p)) {
                    var T = $n(
                        Fn(
                          (J
                            ? qr(N)
                            : [].concat(g.exit, N, se.entry).filter(function (U) {
                                return U;
                              })
                          ).map(function (U) {
                            return Pn(U, o._options.actions);
                          }),
                          f,
                          p,
                        ),
                        3,
                      ),
                      fe = T[0],
                      Ae = T[1],
                      q = T[2],
                      ie = v != null ? v : h;
                    return {
                      value: ie,
                      context: Ae,
                      actions: fe,
                      changed: v !== h || fe.length > 0 || q,
                      matches: Ir(ie),
                    };
                  }
                }
              } catch (U) {
                l = { error: U };
              } finally {
                try {
                  y && !y.done && (u = d.return) && u.call(d);
                } finally {
                  if (l) throw l.error;
                }
              }
            }
            return Ln(h, f);
          },
        };
      return o;
    }
    var Bn = function (s, e) {
      return s.actions.forEach(function (t) {
        var r = t.exec;
        return r && r(s.context, e);
      });
    };
    function Ga(s) {
      var e = s.initialState,
        t = Ye.NotStarted,
        r = new Set(),
        i = {
          _machine: s,
          send: function (o) {
            t === Ye.Running &&
              ((e = s.transition(e, o)),
              Bn(e, za(o)),
              r.forEach(function (n) {
                return n(e);
              }));
          },
          subscribe: function (o) {
            return (
              r.add(o),
              o(e),
              {
                unsubscribe: function () {
                  return r.delete(o);
                },
              }
            );
          },
          start: function (o) {
            if (o) {
              var n = typeof o == "object" ? o : { context: s.config.context, value: o };
              e = {
                value: n.value,
                actions: [],
                context: n.context,
                matches: Ir(n.value),
              };
            }
            return (t = Ye.Running), Bn(e, Wa), i;
          },
          stop: function () {
            return (t = Ye.Stopped), r.clear(), i;
          },
          get state() {
            return e;
          },
          get status() {
            return t;
          },
        };
      return i;
    }
    function Jd(s, e) {
      for (let t = s.length - 1; t >= 0; t--) {
        const r = s[t];
        if (r.type === I.Meta && r.timestamp <= e) return s.slice(t);
      }
      return s;
    }
    function Kd(s, { getCastFn: e, applyEventsSynchronously: t, emitter: r }) {
      const i = Va(
        {
          id: "player",
          context: s,
          initial: "paused",
          states: {
            playing: {
              on: {
                PAUSE: { target: "paused", actions: ["pause"] },
                CAST_EVENT: { target: "playing", actions: "castEvent" },
                END: {
                  target: "paused",
                  actions: ["resetLastPlayedEvent", "pause"],
                },
                ADD_EVENT: { target: "playing", actions: ["addEvent"] },
              },
            },
            paused: {
              on: {
                PLAY: {
                  target: "playing",
                  actions: ["recordTimeOffset", "play"],
                },
                CAST_EVENT: { target: "paused", actions: "castEvent" },
                TO_LIVE: { target: "live", actions: ["startLive"] },
                ADD_EVENT: { target: "paused", actions: ["addEvent"] },
              },
            },
            live: {
              on: {
                ADD_EVENT: { target: "live", actions: ["addEvent"] },
                CAST_EVENT: { target: "live", actions: ["castEvent"] },
              },
            },
          },
        },
        {
          actions: {
            castEvent: We({
              lastPlayedEvent: (o, n) => (n.type === "CAST_EVENT" ? n.payload.event : o.lastPlayedEvent),
            }),
            recordTimeOffset: We((o, n) => {
              let a = o.timeOffset;
              return (
                "payload" in n && "timeOffset" in n.payload && (a = n.payload.timeOffset),
                Q(R({}, o), {
                  timeOffset: a,
                  baselineTime: o.events[0].timestamp + a,
                })
              );
            }),
            play(o) {
              var n;
              const { timer: a, events: l, baselineTime: u, lastPlayedEvent: c } = o;
              a.clear();
              for (const g of l) kn(g, u);
              const h = Jd(l, u);
              let f = c == null ? void 0 : c.timestamp;
              (c == null ? void 0 : c.type) === I.IncrementalSnapshot &&
                c.data.source === E.MouseMove &&
                (f = c.timestamp + ((n = c.data.positions[0]) == null ? void 0 : n.timeOffset)),
                u < (f || 0) && r.emit(k.PlayBack);
              const p = new Array();
              for (const g of h)
                if (!(f && f < u && (g.timestamp <= f || g === c)))
                  if (g.timestamp < u) p.push(g);
                  else {
                    const m = e(g, !1);
                    a.addAction({
                      doAction: () => {
                        m();
                      },
                      delay: g.delay,
                    });
                  }
              t(p), r.emit(k.Flush), a.start();
            },
            pause(o) {
              o.timer.clear();
            },
            resetLastPlayedEvent: We((o) => Q(R({}, o), { lastPlayedEvent: null })),
            startLive: We({
              baselineTime: (o, n) => (
                o.timer.start(), n.type === "TO_LIVE" && n.payload.baselineTime ? n.payload.baselineTime : Date.now()
              ),
            }),
            addEvent: We((o, n) => {
              const { baselineTime: a, timer: l, events: u } = o;
              if (n.type === "ADD_EVENT") {
                const { event: c } = n.payload;
                kn(c, a);
                let h = u.length - 1;
                if (!u[h] || u[h].timestamp <= c.timestamp) u.push(c);
                else {
                  let g = -1,
                    m = 0;
                  for (; m <= h; ) {
                    const d = Math.floor((m + h) / 2);
                    u[d].timestamp <= c.timestamp ? (m = d + 1) : (h = d - 1);
                  }
                  g === -1 && (g = m), u.splice(g, 0, c);
                }
                const f = c.timestamp < a,
                  p = e(c, f);
                f
                  ? p()
                  : l.isActive() &&
                    l.addAction({
                      doAction: () => {
                        p();
                      },
                      delay: c.delay,
                    });
              }
              return Q(R({}, o), { events: u });
            }),
          },
        },
      );
      return Ga(i);
    }
    function Qd(s) {
      const e = Va(
        {
          id: "speed",
          context: s,
          initial: "normal",
          states: {
            normal: {
              on: {
                FAST_FORWARD: {
                  target: "skipping",
                  actions: ["recordSpeed", "setSpeed"],
                },
                SET_SPEED: { target: "normal", actions: ["setSpeed"] },
              },
            },
            skipping: {
              on: {
                BACK_TO_NORMAL: { target: "normal", actions: ["restoreSpeed"] },
                SET_SPEED: { target: "normal", actions: ["setSpeed"] },
              },
            },
          },
        },
        {
          actions: {
            setSpeed: (t, r) => {
              "payload" in r && t.timer.setSpeed(r.payload.speed);
            },
            recordSpeed: We({ normalSpeed: (t) => t.timer.speed }),
            restoreSpeed: (t) => {
              t.timer.setSpeed(t.normalSpeed);
            },
          },
        },
      );
      return Ga(e);
    }
    const qd = (s) => [`.${s} { background: currentColor }`, "noscript { display: none !important; }"],
      Un = new Map();
    function ja(s, e) {
      let t = Un.get(s);
      return t || ((t = new Map()), Un.set(s, t)), t.has(e) || t.set(e, []), t.get(e);
    }
    function Ie(s, e, t) {
      return async (r) => {
        if (r && typeof r == "object" && "rr_type" in r)
          if ((t && (t.isUnchanged = !1), r.rr_type === "ImageBitmap" && "args" in r)) {
            const i = await Ie(s, e, t)(r.args);
            return await createImageBitmap.apply(null, i);
          } else if ("index" in r) {
            if (t || e === null) return r;
            const { rr_type: i, index: o } = r;
            return ja(e, i)[o];
          } else if ("args" in r) {
            const { rr_type: i, args: o } = r,
              n = window[i];
            return new n(...(await Promise.all(o.map(Ie(s, e, t)))));
          } else {
            if ("base64" in r) return Ld(r.base64);
            if ("src" in r) {
              const i = s.get(r.src);
              if (i) return i;
              {
                const o = new Image();
                return (o.src = r.src), s.set(r.src, o), o;
              }
            } else if ("data" in r && r.rr_type === "Blob") {
              const i = await Promise.all(r.data.map(Ie(s, e, t)));
              return new Blob(i, { type: r.type });
            }
          }
        else if (Array.isArray(r)) return await Promise.all(r.map(Ie(s, e, t)));
        return r;
      };
    }
    function ep(s, e) {
      try {
        return e === Se.WebGL ? s.getContext("webgl") || s.getContext("experimental-webgl") : s.getContext("webgl2");
      } catch (t) {
        return null;
      }
    }
    const tp = [
      "WebGLActiveInfo",
      "WebGLBuffer",
      "WebGLFramebuffer",
      "WebGLProgram",
      "WebGLRenderbuffer",
      "WebGLShader",
      "WebGLShaderPrecisionFormat",
      "WebGLTexture",
      "WebGLUniformLocation",
      "WebGLVertexArrayObject",
    ];
    function rp(s, e) {
      if (!(e != null && e.constructor)) return;
      const { name: t } = e.constructor;
      if (!tp.includes(t)) return;
      const r = ja(s, t);
      r.includes(e) || r.push(e);
    }
    async function sp({ mutation: s, target: e, type: t, imageMap: r, errorHandler: i }) {
      try {
        const o = ep(e, t);
        if (!o) return;
        if (s.setter) {
          o[s.property] = s.args[0];
          return;
        }
        const n = o[s.property],
          a = await Promise.all(s.args.map(Ie(r, o))),
          l = n.apply(o, a);
        rp(o, l);
        const u = !1;
      } catch (o) {
        i(s, o);
      }
    }
    async function ip({ event: s, mutations: e, target: t, imageMap: r, errorHandler: i }) {
      const o = t.getContext("2d");
      if (!o) {
        i(e[0], new Error("Canvas context is null"));
        return;
      }
      const n = e.map(async (l) => Promise.all(l.args.map(Ie(r, o))));
      (await Promise.all(n)).forEach((l, u) => {
        const c = e[u];
        try {
          if (c.setter) {
            o[c.property] = c.args[0];
            return;
          }
          const h = o[c.property];
          c.property === "drawImage" && typeof c.args[0] == "string" ? (r.get(s), h.apply(o, c.args)) : h.apply(o, l);
        } catch (h) {
          i(c, h);
        }
      });
    }
    async function $s({ event: s, mutation: e, target: t, imageMap: r, canvasEventMap: i, errorHandler: o }) {
      try {
        const n = i.get(s) || e,
          a = "commands" in n ? n.commands : [n];
        if ([Se.WebGL, Se.WebGL2].includes(e.type)) {
          for (let l = 0; l < a.length; l++) {
            const u = a[l];
            await sp({
              mutation: u,
              type: e.type,
              target: t,
              imageMap: r,
              errorHandler: o,
            });
          }
          return;
        }
        await ip({
          event: s,
          mutations: a,
          target: t,
          imageMap: r,
          errorHandler: o,
        });
      } catch (n) {
        o(e, n);
      }
    }
    class np {
      constructor(e) {
        b(this, "mediaMap", new Map()),
          b(this, "warn"),
          b(this, "service"),
          b(this, "speedService"),
          b(this, "emitter"),
          b(this, "getCurrentTime"),
          b(this, "metadataCallbackMap", new Map()),
          (this.warn = e.warn),
          (this.service = e.service),
          (this.speedService = e.speedService),
          (this.emitter = e.emitter),
          (this.getCurrentTime = e.getCurrentTime),
          this.emitter.on(k.Start, this.start.bind(this)),
          this.emitter.on(k.SkipStart, this.start.bind(this)),
          this.emitter.on(k.Pause, this.pause.bind(this)),
          this.emitter.on(k.Finish, this.pause.bind(this)),
          this.speedService.subscribe(() => {
            this.syncAllMediaElements();
          });
      }
      syncAllMediaElements(e = { pause: !1 }) {
        this.mediaMap.forEach((t, r) => {
          this.syncTargetWithState(r), e.pause && r.pause();
        });
      }
      start() {
        this.syncAllMediaElements();
      }
      pause() {
        this.syncAllMediaElements({ pause: !0 });
      }
      seekTo({ time: e, target: t, mediaState: r }) {
        if (r.isPlaying) {
          const o = ((e - r.lastInteractionTimeOffset) / 1e3) * r.playbackRate,
            n = "duration" in t && t.duration;
          if (Number.isNaN(n)) {
            this.waitForMetadata(t);
            return;
          }
          let a = r.currentTimeAtLastInteraction + o;
          t.loop && n !== !1 && (a = a % n), (t.currentTime = a);
        } else t.pause(), (t.currentTime = r.currentTimeAtLastInteraction);
      }
      waitForMetadata(e) {
        if (this.metadataCallbackMap.has(e) || !("addEventListener" in e)) return;
        const t = () => {
          this.metadataCallbackMap.delete(e);
          const r = this.mediaMap.get(e);
          r &&
            this.seekTo({
              time: this.getCurrentTime(),
              target: e,
              mediaState: r,
            });
        };
        this.metadataCallbackMap.set(e, t), e.addEventListener("loadedmetadata", t, { once: !0 });
      }
      getMediaStateFromMutation({ target: e, timeOffset: t, mutation: r }) {
        var p, g, m, d, y;
        const i = this.mediaMap.get(e),
          { type: o, playbackRate: n, currentTime: a, muted: l, volume: u, loop: c } = r;
        return {
          isPlaying:
            o === Ce.Play ||
            (o !== Ce.Pause && ((i == null ? void 0 : i.isPlaying) || e.getAttribute("autoplay") !== null)),
          currentTimeAtLastInteraction:
            (p = a != null ? a : i == null ? void 0 : i.currentTimeAtLastInteraction) != null ? p : 0,
          lastInteractionTimeOffset: t,
          playbackRate: (g = n != null ? n : i == null ? void 0 : i.playbackRate) != null ? g : 1,
          volume: (m = u != null ? u : i == null ? void 0 : i.volume) != null ? m : 1,
          muted: (d = l != null ? l : i == null ? void 0 : i.muted) != null ? d : e.getAttribute("muted") === null,
          loop: (y = c != null ? c : i == null ? void 0 : i.loop) != null ? y : e.getAttribute("loop") === null,
        };
      }
      syncTargetWithState(e) {
        const t = this.mediaMap.get(e);
        if (!t) return;
        const { muted: r, loop: i, volume: o, isPlaying: n } = t,
          a = this.service.state.matches("paused"),
          l = t.playbackRate * this.speedService.state.context.timer.speed;
        try {
          this.seekTo({
            time: this.getCurrentTime(),
            target: e,
            mediaState: t,
          }),
            e.volume !== o && (e.volume = o),
            (e.muted = r),
            (e.loop = i),
            e.playbackRate !== l && (e.playbackRate = l),
            n && !a ? e.play() : e.pause();
        } catch (u) {
          this.warn(`Failed to replay media interactions: ${u.message || u}`);
        }
      }
      addMediaElements(e, t, r) {
        if (!["AUDIO", "VIDEO"].includes(e.nodeName)) return;
        const i = e,
          o = r.getMeta(i);
        if (!o || !("attributes" in o)) return;
        const n = this.service.state.matches("paused"),
          a = o.attributes;
        let l = !1;
        a.rr_mediaState ? (l = a.rr_mediaState === "played") : (l = i.getAttribute("autoplay") !== null),
          l && n && i.pause();
        let u = 1;
        typeof a.rr_mediaPlaybackRate == "number" && (u = a.rr_mediaPlaybackRate);
        let c = !1;
        typeof a.rr_mediaMuted == "boolean" ? (c = a.rr_mediaMuted) : (c = i.getAttribute("muted") !== null);
        let h = !1;
        typeof a.rr_mediaLoop == "boolean" ? (h = a.rr_mediaLoop) : (h = i.getAttribute("loop") !== null);
        let f = 1;
        typeof a.rr_mediaVolume == "number" && (f = a.rr_mediaVolume);
        let p = 0;
        typeof a.rr_mediaCurrentTime == "number" && (p = a.rr_mediaCurrentTime),
          this.mediaMap.set(i, {
            isPlaying: l,
            currentTimeAtLastInteraction: p,
            lastInteractionTimeOffset: t,
            playbackRate: u,
            volume: f,
            muted: c,
            loop: h,
          }),
          this.syncTargetWithState(i);
      }
      mediaMutation({ target: e, timeOffset: t, mutation: r }) {
        this.mediaMap.set(
          e,
          this.getMediaStateFromMutation({
            target: e,
            timeOffset: t,
            mutation: r,
          }),
        ),
          this.syncTargetWithState(e);
      }
      isSupportedMediaElement(e) {
        return ["AUDIO", "VIDEO"].includes(e.nodeName);
      }
      reset() {
        this.mediaMap.clear();
      }
    }
    function er(s, e) {
      if (s.nodeName !== "DIALOG" || s instanceof he) return;
      const t = s,
        r = t.open,
        i = r && t.matches("dialog:modal"),
        o = t.getAttribute("rr_open_mode"),
        n = typeof (e == null ? void 0 : e.attributes.open) == "string" || typeof t.getAttribute("open") == "string",
        a = o === "modal";
      if (!(r && !((i && o === "non-modal") || (!i && a)))) {
        if (!t.isConnected) {
          console.warn("dialog is not attached to the dom", t);
          return;
        }
        r && t.close(), n && (a ? t.showModal() : t.show());
      }
    }
    function op(s, e) {
      if (s.nodeName !== "DIALOG" || s instanceof he) return;
      const t = s;
      if (!t.isConnected) {
        console.warn("dialog is not attached to the dom", t);
        return;
      }
      e.attributes.open === null && (t.removeAttribute("open"), t.removeAttribute("rr_open_mode"));
    }
    const ap = 5 * 1e3,
      lp = Ua || Hd,
      Wn = "[replayer]",
      es = {
        duration: 500,
        lineCap: "round",
        lineWidth: 3,
        strokeStyle: "red",
      };
    function zn(s) {
      return (
        s.type == I.IncrementalSnapshot &&
        (s.data.source == E.TouchMove || (s.data.source == E.MouseInteraction && s.data.type == $.TouchStart))
      );
    }
    class up {
      constructor(e, t) {
        if (
          (b(this, "wrapper"),
          b(this, "iframe"),
          b(this, "service"),
          b(this, "speedService"),
          b(this, "config"),
          b(this, "usingVirtualDom", !1),
          b(this, "virtualDom", new tt()),
          b(this, "mouse"),
          b(this, "mouseTail", null),
          b(this, "tailPositions", []),
          b(this, "emitter", lp()),
          b(this, "nextUserInteractionEvent"),
          b(this, "legacy_missingNodeRetryMap", {}),
          b(this, "cache", rn()),
          b(this, "imageMap", new Map()),
          b(this, "canvasEventMap", new Map()),
          b(this, "mirror", jn()),
          b(this, "styleMirror", new vi()),
          b(this, "mediaManager"),
          b(this, "firstFullSnapshot", null),
          b(this, "newDocumentQueue", []),
          b(this, "mousePos", null),
          b(this, "touchActive", null),
          b(this, "lastMouseDownEvent", null),
          b(this, "lastHoveredRootNode"),
          b(this, "lastSelectionData", null),
          b(this, "constructedStyleMutations", []),
          b(this, "adoptedStyleSheets", []),
          b(this, "handleResize", (a) => {
            this.iframe.style.display = "inherit";
            for (const l of [this.mouseTail, this.iframe])
              l && (l.setAttribute("width", String(a.width)), l.setAttribute("height", String(a.height)));
          }),
          b(this, "applyEventsSynchronously", (a) => {
            for (const l of a) {
              switch (l.type) {
                case I.DomContentLoaded:
                case I.Load:
                case I.Custom:
                  continue;
                case I.FullSnapshot:
                case I.Meta:
                case I.Plugin:
                case I.IncrementalSnapshot:
                  break;
              }
              this.getCastFn(l, !0)();
            }
          }),
          b(this, "getCastFn", (a, l = !1) => {
            let u;
            switch (a.type) {
              case I.DomContentLoaded:
              case I.Load:
                break;
              case I.Custom:
                u = () => {
                  this.emitter.emit(k.CustomEvent, a);
                };
                break;
              case I.Meta:
                u = () =>
                  this.emitter.emit(k.Resize, {
                    width: a.data.width,
                    height: a.data.height,
                  });
                break;
              case I.FullSnapshot:
                u = () => {
                  var h;
                  if (this.firstFullSnapshot) {
                    if (this.firstFullSnapshot === a) {
                      this.firstFullSnapshot = !0;
                      return;
                    }
                  } else this.firstFullSnapshot = !0;
                  this.mediaManager.reset(),
                    this.styleMirror.reset(),
                    this.rebuildFullSnapshot(a, l),
                    (h = this.iframe.contentWindow) == null || h.scrollTo(a.data.initialOffset);
                };
                break;
              case I.IncrementalSnapshot:
                u = () => {
                  if (
                    (this.applyIncremental(a, l),
                    !l &&
                      (a === this.nextUserInteractionEvent &&
                        ((this.nextUserInteractionEvent = null), this.backToNormal()),
                      this.config.skipInactive && !this.nextUserInteractionEvent))
                  ) {
                    for (const h of this.service.state.context.events)
                      if (!(h.timestamp <= a.timestamp) && this.isUserInteraction(h)) {
                        h.delay - a.delay >
                          this.config.inactivePeriodThreshold * this.speedService.state.context.timer.speed &&
                          (this.nextUserInteractionEvent = h);
                        break;
                      }
                    if (this.nextUserInteractionEvent) {
                      const h = this.nextUserInteractionEvent.delay - a.delay,
                        f = {
                          speed: Math.min(Math.round(h / ap), this.config.maxSpeed),
                        };
                      this.speedService.send({
                        type: "FAST_FORWARD",
                        payload: f,
                      }),
                        this.emitter.emit(k.SkipStart, f);
                    }
                  }
                };
                break;
            }
            return () => {
              u && u();
              for (const f of this.config.plugins || []) f.handler && f.handler(a, l, { replayer: this });
              this.service.send({ type: "CAST_EVENT", payload: { event: a } });
              const h = this.service.state.context.events.length - 1;
              if (!this.config.liveMode && a === this.service.state.context.events[h]) {
                const f = () => {
                  h < this.service.state.context.events.length - 1 ||
                    (this.backToNormal(), this.service.send("END"), this.emitter.emit(k.Finish));
                };
                let p = 50;
                a.type === I.IncrementalSnapshot &&
                  a.data.source === E.MouseMove &&
                  a.data.positions.length &&
                  (p += Math.max(0, -a.data.positions[0].timeOffset)),
                  setTimeout(f, p);
              }
              this.emitter.emit(k.EventCast, a);
            };
          }),
          !(t != null && t.liveMode) && e.length < 2)
        )
          throw new Error("Replayer need at least 2 events.");
        const r = {
          speed: 1,
          maxSpeed: 360,
          root: document.body,
          loadTimeout: 0,
          skipInactive: !1,
          inactivePeriodThreshold: 10 * 1e3,
          showWarning: !0,
          showDebug: !1,
          blockClass: "rr-block",
          liveMode: !1,
          insertStyleRules: [],
          triggerFocus: !0,
          UNSAFE_replayCanvas: !1,
          pauseAnimation: !0,
          mouseTail: es,
          useVirtualDom: !0,
          logger: console,
        };
        (this.config = Object.assign({}, r, t)),
          (this.handleResize = this.handleResize.bind(this)),
          (this.getCastFn = this.getCastFn.bind(this)),
          (this.applyEventsSynchronously = this.applyEventsSynchronously.bind(this)),
          this.emitter.on(k.Resize, this.handleResize),
          this.setupDom();
        for (const a of this.config.plugins || []) a.getMirror && a.getMirror({ nodeMirror: this.mirror });
        this.emitter.on(k.Flush, () => {
          if (this.usingVirtualDom) {
            const a = {
              mirror: this.mirror,
              applyCanvas: (l, u, c) => {
                $s({
                  event: l,
                  mutation: u,
                  target: c,
                  imageMap: this.imageMap,
                  canvasEventMap: this.canvasEventMap,
                  errorHandler: this.warnCanvasMutationFailed.bind(this),
                });
              },
              applyInput: this.applyInput.bind(this),
              applyScroll: this.applyScroll.bind(this),
              applyStyleSheetMutation: (l, u) => {
                l.source === E.StyleSheetRule
                  ? this.applyStyleSheetRule(l, u)
                  : l.source === E.StyleDeclaration && this.applyStyleDeclaration(l, u);
              },
              afterAppend: (l, u) => {
                for (const c of this.config.plugins || []) c.onBuild && c.onBuild(l, { id: u, replayer: this });
              },
            };
            if (this.iframe.contentDocument)
              try {
                br(this.iframe.contentDocument, this.virtualDom, a, this.virtualDom.mirror);
              } catch (l) {
                console.warn(l);
              }
            if (
              (this.virtualDom.destroyTree(),
              (this.usingVirtualDom = !1),
              Object.keys(this.legacy_missingNodeRetryMap).length)
            )
              for (const l in this.legacy_missingNodeRetryMap)
                try {
                  const u = this.legacy_missingNodeRetryMap[l],
                    c = Sr(u.node, this.mirror, this.virtualDom.mirror);
                  br(c, u.node, a, this.virtualDom.mirror), (u.node = c);
                } catch (u) {
                  this.warn(u);
                }
            this.constructedStyleMutations.forEach((l) => {
              this.applyStyleSheetMutation(l);
            }),
              (this.constructedStyleMutations = []),
              this.adoptedStyleSheets.forEach((l) => {
                this.applyAdoptedStyleSheet(l);
              }),
              (this.adoptedStyleSheets = []);
          }
          if (
            (this.mousePos &&
              (this.moveAndHover(this.mousePos.x, this.mousePos.y, this.mousePos.id, !0, this.mousePos.debugData),
              (this.mousePos = null)),
            this.touchActive === !0
              ? this.mouse.classList.add("touch-active")
              : this.touchActive === !1 && this.mouse.classList.remove("touch-active"),
            (this.touchActive = null),
            this.lastMouseDownEvent)
          ) {
            const [a, l] = this.lastMouseDownEvent;
            a.dispatchEvent(l);
          }
          (this.lastMouseDownEvent = null),
            this.lastSelectionData && (this.applySelection(this.lastSelectionData), (this.lastSelectionData = null));
        }),
          this.emitter.on(k.PlayBack, () => {
            (this.firstFullSnapshot = null), this.mirror.reset(), this.styleMirror.reset(), this.mediaManager.reset();
          });
        const i = new Xd([], { speed: this.config.speed });
        (this.service = Kd(
          {
            events: e.map((a) => (t && t.unpackFn ? t.unpackFn(a) : a)).sort((a, l) => a.timestamp - l.timestamp),
            timer: i,
            timeOffset: 0,
            baselineTime: 0,
            lastPlayedEvent: null,
          },
          {
            getCastFn: this.getCastFn,
            applyEventsSynchronously: this.applyEventsSynchronously,
            emitter: this.emitter,
          },
        )),
          this.service.start(),
          this.service.subscribe((a) => {
            this.emitter.emit(k.StateChange, { player: a });
          }),
          (this.speedService = Qd({ normalSpeed: -1, timer: i })),
          this.speedService.start(),
          this.speedService.subscribe((a) => {
            this.emitter.emit(k.StateChange, { speed: a });
          }),
          (this.mediaManager = new np({
            warn: this.warn.bind(this),
            service: this.service,
            speedService: this.speedService,
            emitter: this.emitter,
            getCurrentTime: this.getCurrentTime.bind(this),
          }));
        const o = this.service.state.context.events.find((a) => a.type === I.Meta),
          n = this.service.state.context.events.find((a) => a.type === I.FullSnapshot);
        if (o) {
          const { width: a, height: l } = o.data;
          setTimeout(() => {
            this.emitter.emit(k.Resize, { width: a, height: l });
          }, 0);
        }
        n &&
          setTimeout(() => {
            var a;
            this.firstFullSnapshot ||
              ((this.firstFullSnapshot = n),
              this.rebuildFullSnapshot(n),
              (a = this.iframe.contentWindow) == null || a.scrollTo(n.data.initialOffset));
          }, 1),
          this.service.state.context.events.find(zn) && this.mouse.classList.add("touch-device");
      }
      get timer() {
        return this.service.state.context.timer;
      }
      on(e, t) {
        return this.emitter.on(e, t), this;
      }
      off(e, t) {
        return this.emitter.off(e, t), this;
      }
      setConfig(e) {
        Object.keys(e).forEach((t) => {
          e[t], (this.config[t] = e[t]);
        }),
          this.config.skipInactive || this.backToNormal(),
          typeof e.speed != "undefined" &&
            this.speedService.send({
              type: "SET_SPEED",
              payload: { speed: e.speed },
            }),
          typeof e.mouseTail != "undefined" &&
            (e.mouseTail === !1
              ? this.mouseTail && (this.mouseTail.style.display = "none")
              : (this.mouseTail ||
                  ((this.mouseTail = document.createElement("canvas")),
                  (this.mouseTail.width = Number.parseFloat(this.iframe.width)),
                  (this.mouseTail.height = Number.parseFloat(this.iframe.height)),
                  this.mouseTail.classList.add("replayer-mouse-tail"),
                  this.wrapper.insertBefore(this.mouseTail, this.iframe)),
                (this.mouseTail.style.display = "inherit")));
      }
      getMetaData() {
        const e = this.service.state.context.events[0],
          t = this.service.state.context.events[this.service.state.context.events.length - 1];
        return {
          startTime: e.timestamp,
          endTime: t.timestamp,
          totalTime: t.timestamp - e.timestamp,
        };
      }
      getCurrentTime() {
        return this.timer.timeOffset + this.getTimeOffset();
      }
      getTimeOffset() {
        const { baselineTime: e, events: t } = this.service.state.context;
        return e - t[0].timestamp;
      }
      getMirror() {
        return this.mirror;
      }
      play(e = 0) {
        var t, r;
        this.service.state.matches("paused")
          ? this.service.send({ type: "PLAY", payload: { timeOffset: e } })
          : (this.service.send({ type: "PAUSE" }), this.service.send({ type: "PLAY", payload: { timeOffset: e } })),
          (r = (t = this.iframe.contentDocument) == null ? void 0 : t.getElementsByTagName("html")[0]) == null ||
            r.classList.remove("rrweb-paused"),
          this.emitter.emit(k.Start);
      }
      pause(e) {
        var t, r;
        e === void 0 && this.service.state.matches("playing") && this.service.send({ type: "PAUSE" }),
          typeof e == "number" && (this.play(e), this.service.send({ type: "PAUSE" })),
          (r = (t = this.iframe.contentDocument) == null ? void 0 : t.getElementsByTagName("html")[0]) == null ||
            r.classList.add("rrweb-paused"),
          this.emitter.emit(k.Pause);
      }
      resume(e = 0) {
        this.warn("The 'resume' was deprecated in 1.0. Please use 'play' method which has the same interface."),
          this.play(e),
          this.emitter.emit(k.Resume);
      }
      destroy() {
        this.pause(),
          this.mirror.reset(),
          this.styleMirror.reset(),
          this.mediaManager.reset(),
          this.config.root.removeChild(this.wrapper),
          this.emitter.emit(k.Destroy);
      }
      startLive(e) {
        this.service.send({ type: "TO_LIVE", payload: { baselineTime: e } });
      }
      addEvent(e) {
        const t = this.config.unpackFn ? this.config.unpackFn(e) : e;
        zn(t) && this.mouse.classList.add("touch-device"),
          Promise.resolve().then(() => this.service.send({ type: "ADD_EVENT", payload: { event: t } }));
      }
      enableInteract() {
        this.iframe.setAttribute("scrolling", "auto"), (this.iframe.style.pointerEvents = "auto");
      }
      disableInteract() {
        this.iframe.setAttribute("scrolling", "no"), (this.iframe.style.pointerEvents = "none");
      }
      resetCache() {
        this.cache = rn();
      }
      setupDom() {
        (this.wrapper = document.createElement("div")),
          this.wrapper.classList.add("replayer-wrapper"),
          this.config.root.appendChild(this.wrapper),
          (this.mouse = document.createElement("div")),
          this.mouse.classList.add("replayer-mouse"),
          this.wrapper.appendChild(this.mouse),
          this.config.mouseTail !== !1 &&
            ((this.mouseTail = document.createElement("canvas")),
            this.mouseTail.classList.add("replayer-mouse-tail"),
            (this.mouseTail.style.display = "inherit"),
            this.wrapper.appendChild(this.mouseTail)),
          (this.iframe = document.createElement("iframe"));
        const e = ["allow-same-origin"];
        this.config.UNSAFE_replayCanvas && e.push("allow-scripts"),
          (this.iframe.style.display = "none"),
          this.iframe.setAttribute("sandbox", e.join(" ")),
          this.disableInteract(),
          this.wrapper.appendChild(this.iframe),
          this.iframe.contentWindow &&
            this.iframe.contentDocument &&
            (Zd(this.iframe.contentWindow, this.iframe.contentDocument), yi(this.iframe.contentWindow));
      }
      rebuildFullSnapshot(e, t = !1) {
        if (!this.iframe.contentDocument) return this.warn("Looks like your replayer has been destroyed.");
        Object.keys(this.legacy_missingNodeRetryMap).length &&
          this.warn("Found unresolved missing node map", this.legacy_missingNodeRetryMap),
          (this.legacy_missingNodeRetryMap = {});
        const r = [],
          i = new Set(),
          o = (l, u) => {
            if (
              (l.nodeName === "DIALOG" && i.add(l),
              this.collectIframeAndAttachDocument(r, l),
              this.mediaManager.isSupportedMediaElement(l))
            ) {
              const { events: c } = this.service.state.context;
              this.mediaManager.addMediaElements(l, e.timestamp - c[0].timestamp, this.mirror);
            }
            for (const c of this.config.plugins || []) c.onBuild && c.onBuild(l, { id: u, replayer: this });
          };
        this.usingVirtualDom && (this.virtualDom.destroyTree(), (this.usingVirtualDom = !1)),
          this.mirror.reset(),
          Pc(e.data.node, {
            doc: this.iframe.contentDocument,
            afterAppend: o,
            cache: this.cache,
            mirror: this.mirror,
          }),
          o(this.iframe.contentDocument, e.data.node.id);
        for (const { mutationInQueue: l, builtNode: u } of r)
          this.attachDocumentToIframe(l, u), (this.newDocumentQueue = this.newDocumentQueue.filter((c) => c !== l));
        const { documentElement: n, head: a } = this.iframe.contentDocument;
        this.insertStyleRules(n, a),
          i.forEach((l) => er(l)),
          this.service.state.matches("playing") ||
            this.iframe.contentDocument.getElementsByTagName("html")[0].classList.add("rrweb-paused"),
          this.emitter.emit(k.FullsnapshotRebuilded, e),
          t || this.waitForStylesheetLoad(),
          this.config.UNSAFE_replayCanvas && this.preloadAllImages();
      }
      insertStyleRules(e, t) {
        var r;
        const i = qd(this.config.blockClass).concat(this.config.insertStyleRules);
        if (
          (this.config.pauseAnimation &&
            i.push(
              "html.rrweb-paused *, html.rrweb-paused *:before, html.rrweb-paused *:after { animation-play-state: paused !important; }",
            ),
          this.usingVirtualDom)
        ) {
          const o = this.virtualDom.createElement("style");
          this.virtualDom.mirror.add(o, Ia(o, this.virtualDom.unserializedId)),
            e.insertBefore(o, t),
            o.rules.push({
              source: E.StyleSheetRule,
              adds: i.map((n, a) => ({ rule: n, index: a })),
            });
        } else {
          const o = document.createElement("style");
          e.insertBefore(o, t);
          for (let n = 0; n < i.length; n++) (r = o.sheet) == null || r.insertRule(i[n], n);
        }
      }
      attachDocumentToIframe(e, t) {
        const r = this.usingVirtualDom ? this.virtualDom.mirror : this.mirror,
          i = [],
          o = new Set(),
          n = (a, l) => {
            a.nodeName === "DIALOG" && o.add(a), this.collectIframeAndAttachDocument(i, a);
            const u = r.getMeta(a);
            if (
              (u == null ? void 0 : u.type) === M.Element &&
              (u == null ? void 0 : u.tagName.toUpperCase()) === "HTML"
            ) {
              const { documentElement: c, head: h } = t.contentDocument;
              this.insertStyleRules(c, h);
            }
            if (!this.usingVirtualDom)
              for (const c of this.config.plugins || []) c.onBuild && c.onBuild(a, { id: l, replayer: this });
          };
        ct(e.node, {
          doc: t.contentDocument,
          mirror: r,
          hackCss: !0,
          skipChild: !1,
          afterAppend: n,
          cache: this.cache,
        }),
          n(t.contentDocument, e.node.id);
        for (const { mutationInQueue: a, builtNode: l } of i)
          this.attachDocumentToIframe(a, l), (this.newDocumentQueue = this.newDocumentQueue.filter((u) => u !== a));
        o.forEach((a) => er(a));
      }
      collectIframeAndAttachDocument(e, t) {
        if (He(t, this.mirror)) {
          const r = this.newDocumentQueue.find((i) => i.parentId === this.mirror.getId(t));
          r && e.push({ mutationInQueue: r, builtNode: t });
        }
      }
      waitForStylesheetLoad() {
        var e;
        const t = (e = this.iframe.contentDocument) == null ? void 0 : e.head;
        if (t) {
          const r = new Set();
          let i,
            o = this.service.state;
          const n = () => {
            o = this.service.state;
          };
          this.emitter.on(k.Start, n), this.emitter.on(k.Pause, n);
          const a = () => {
            this.emitter.off(k.Start, n), this.emitter.off(k.Pause, n);
          };
          t.querySelectorAll('link[rel="stylesheet"]').forEach((l) => {
            l.sheet ||
              (r.add(l),
              l.addEventListener("load", () => {
                r.delete(l),
                  r.size === 0 &&
                    i !== -1 &&
                    (o.matches("playing") && this.play(this.getCurrentTime()),
                    this.emitter.emit(k.LoadStylesheetEnd),
                    i && clearTimeout(i),
                    a());
              }));
          }),
            r.size > 0 &&
              (this.service.send({ type: "PAUSE" }),
              this.emitter.emit(k.LoadStylesheetStart),
              (i = setTimeout(() => {
                o.matches("playing") && this.play(this.getCurrentTime()), (i = -1), a();
              }, this.config.loadTimeout)));
        }
      }
      async preloadAllImages() {
        const e = [];
        for (const t of this.service.state.context.events)
          t.type === I.IncrementalSnapshot &&
            t.data.source === E.CanvasMutation &&
            (e.push(this.deserializeAndPreloadCanvasEvents(t.data, t)),
            ("commands" in t.data ? t.data.commands : [t.data]).forEach((i) => {
              this.preloadImages(i, t);
            }));
        return Promise.all(e);
      }
      preloadImages(e, t) {
        if (e.property === "drawImage" && typeof e.args[0] == "string" && !this.imageMap.has(t)) {
          const r = document.createElement("canvas"),
            i = r.getContext("2d"),
            o = i == null ? void 0 : i.createImageData(r.width, r.height);
          i == null || i.putImageData(o, 0, 0);
        }
      }
      async deserializeAndPreloadCanvasEvents(e, t) {
        if (!this.canvasEventMap.has(t)) {
          const r = { isUnchanged: !0 };
          if ("commands" in e) {
            const i = await Promise.all(
              e.commands.map(async (o) => {
                const n = await Promise.all(o.args.map(Ie(this.imageMap, null, r)));
                return Q(R({}, o), { args: n });
              }),
            );
            r.isUnchanged === !1 && this.canvasEventMap.set(t, Q(R({}, e), { commands: i }));
          } else {
            const i = await Promise.all(e.args.map(Ie(this.imageMap, null, r)));
            r.isUnchanged === !1 && this.canvasEventMap.set(t, Q(R({}, e), { args: i }));
          }
        }
      }
      applyIncremental(e, t) {
        var r, i, o;
        const { data: n } = e;
        switch (n.source) {
          case E.Mutation: {
            try {
              this.applyMutation(n, t);
            } catch (a) {
              this.warn(`Exception in mutation ${a.message || a}`, n);
            }
            break;
          }
          case E.Drag:
          case E.TouchMove:
          case E.MouseMove:
            if (t) {
              const a = n.positions[n.positions.length - 1];
              this.mousePos = { x: a.x, y: a.y, id: a.id, debugData: n };
            } else
              n.positions.forEach((a) => {
                const l = {
                  doAction: () => {
                    this.moveAndHover(a.x, a.y, a.id, t, n);
                  },
                  delay: a.timeOffset + e.timestamp - this.service.state.context.baselineTime,
                };
                this.timer.addAction(l);
              }),
                this.timer.addAction({
                  doAction() {},
                  delay: e.delay - ((r = n.positions[0]) == null ? void 0 : r.timeOffset),
                });
            break;
          case E.MouseInteraction: {
            if (n.id === -1) break;
            const a = new Event(xe($[n.type])),
              l = this.mirror.getNode(n.id);
            if (!l) return this.debugNodeNotFound(n, n.id);
            this.emitter.emit(k.MouseInteraction, { type: n.type, target: l });
            const { triggerFocus: u } = this.config;
            switch (n.type) {
              case $.Blur:
                "blur" in l && l.blur();
                break;
              case $.Focus:
                u && l.focus && l.focus({ preventScroll: !0 });
                break;
              case $.Click:
              case $.TouchStart:
              case $.TouchEnd:
              case $.MouseDown:
              case $.MouseUp:
                t
                  ? (n.type === $.TouchStart
                      ? (this.touchActive = !0)
                      : n.type === $.TouchEnd && (this.touchActive = !1),
                    n.type === $.MouseDown
                      ? (this.lastMouseDownEvent = [l, a])
                      : n.type === $.MouseUp && (this.lastMouseDownEvent = null),
                    (this.mousePos = {
                      x: n.x || 0,
                      y: n.y || 0,
                      id: n.id,
                      debugData: n,
                    }))
                  : (n.type === $.TouchStart && (this.tailPositions.length = 0),
                    this.moveAndHover(n.x || 0, n.y || 0, n.id, t, n),
                    n.type === $.Click
                      ? (this.mouse.classList.remove("active"),
                        this.mouse.offsetWidth,
                        this.mouse.classList.add("active"))
                      : n.type === $.TouchStart
                      ? (this.mouse.offsetWidth, this.mouse.classList.add("touch-active"))
                      : n.type === $.TouchEnd
                      ? this.mouse.classList.remove("touch-active")
                      : l.dispatchEvent(a));
                break;
              case $.TouchCancel:
                t ? (this.touchActive = !1) : this.mouse.classList.remove("touch-active");
                break;
              default:
                l.dispatchEvent(a);
            }
            break;
          }
          case E.Scroll: {
            if (n.id === -1) break;
            if (this.usingVirtualDom) {
              const a = this.virtualDom.mirror.getNode(n.id);
              if (!a) return this.debugNodeNotFound(n, n.id);
              a.scrollData = n;
              break;
            }
            this.applyScroll(n, t);
            break;
          }
          case E.ViewportResize:
            this.emitter.emit(k.Resize, { width: n.width, height: n.height });
            break;
          case E.Input: {
            if (n.id === -1) break;
            if (this.usingVirtualDom) {
              const a = this.virtualDom.mirror.getNode(n.id);
              if (!a) return this.debugNodeNotFound(n, n.id);
              a.inputData = n;
              break;
            }
            this.applyInput(n);
            break;
          }
          case E.MediaInteraction: {
            const a = this.usingVirtualDom ? this.virtualDom.mirror.getNode(n.id) : this.mirror.getNode(n.id);
            if (!a) return this.debugNodeNotFound(n, n.id);
            const l = a,
              { events: u } = this.service.state.context;
            this.mediaManager.mediaMutation({
              target: l,
              timeOffset: e.timestamp - u[0].timestamp,
              mutation: n,
            });
            break;
          }
          case E.StyleSheetRule:
          case E.StyleDeclaration: {
            this.usingVirtualDom
              ? n.styleId
                ? this.constructedStyleMutations.push(n)
                : n.id && ((i = this.virtualDom.mirror.getNode(n.id)) == null || i.rules.push(n))
              : this.applyStyleSheetMutation(n);
            break;
          }
          case E.CanvasMutation: {
            if (!this.config.UNSAFE_replayCanvas) return;
            if (this.usingVirtualDom) {
              const a = this.virtualDom.mirror.getNode(n.id);
              if (!a) return this.debugNodeNotFound(n, n.id);
              a.canvasMutations.push({ event: e, mutation: n });
            } else {
              const a = this.mirror.getNode(n.id);
              if (!a) return this.debugNodeNotFound(n, n.id);
              $s({
                event: e,
                mutation: n,
                target: a,
                imageMap: this.imageMap,
                canvasEventMap: this.canvasEventMap,
                errorHandler: this.warnCanvasMutationFailed.bind(this),
              });
            }
            break;
          }
          case E.Font: {
            try {
              const a = new FontFace(
                n.family,
                n.buffer ? new Uint8Array(JSON.parse(n.fontSource)) : n.fontSource,
                n.descriptors,
              );
              (o = this.iframe.contentDocument) == null || o.fonts.add(a);
            } catch (a) {
              this.warn(a);
            }
            break;
          }
          case E.Selection: {
            if (t) {
              this.lastSelectionData = n;
              break;
            }
            this.applySelection(n);
            break;
          }
          case E.AdoptedStyleSheet: {
            this.usingVirtualDom ? this.adoptedStyleSheets.push(n) : this.applyAdoptedStyleSheet(n);
            break;
          }
        }
      }
      applyMutation(e, t) {
        if (
          this.config.useVirtualDom &&
          !this.usingVirtualDom &&
          t &&
          ((this.usingVirtualDom = !0),
          td(this.iframe.contentDocument, this.mirror, this.virtualDom),
          Object.keys(this.legacy_missingNodeRetryMap).length)
        )
          for (const u in this.legacy_missingNodeRetryMap)
            try {
              const c = this.legacy_missingNodeRetryMap[u],
                h = Ea(c.node, this.virtualDom, this.mirror);
              h && (c.node = h);
            } catch (c) {
              this.warn(c);
            }
        const r = this.usingVirtualDom ? this.virtualDom.mirror : this.mirror;
        (e.removes = e.removes.filter((u) => (r.getNode(u.id) ? !0 : (this.warnNodeNotFound(e, u.id), !1)))),
          e.removes.forEach((u) => {
            var c;
            const h = r.getNode(u.id);
            if (!h) return;
            let f = r.getNode(u.parentId);
            if (!f) return this.warnNodeNotFound(e, u.parentId);
            if ((u.isShadow && Ee(f) && (f = f.shadowRoot), r.removeNodeFromMap(h), f))
              try {
                f.removeChild(h),
                  this.usingVirtualDom &&
                    h.nodeName === "#text" &&
                    f.nodeName === "STYLE" &&
                    ((c = f.rules) == null ? void 0 : c.length) > 0 &&
                    (f.rules = []);
              } catch (p) {
                if (p instanceof DOMException) this.warn("parent could not remove child in mutation", f, h, e);
                else throw p;
              }
          });
        const i = R({}, this.legacy_missingNodeRetryMap),
          o = [],
          n = (u) => {
            let c = null;
            return (
              u.nextId && (c = r.getNode(u.nextId)), u.nextId !== null && u.nextId !== void 0 && u.nextId !== -1 && !c
            );
          },
          a = (u) => {
            var c, h;
            if (!this.iframe.contentDocument) return this.warn("Looks like your replayer has been destroyed.");
            let f = r.getNode(u.parentId);
            if (!f) return u.node.type === M.Document ? this.newDocumentQueue.push(u) : o.push(u);
            u.node.isShadow && (Ee(f) || f.attachShadow({ mode: "open" }), (f = f.shadowRoot));
            let p = null,
              g = null;
            if ((u.previousId && (p = r.getNode(u.previousId)), u.nextId && (g = r.getNode(u.nextId)), n(u)))
              return o.push(u);
            if (u.node.rootId && !r.getNode(u.node.rootId)) return;
            const m = u.node.rootId
              ? r.getNode(u.node.rootId)
              : this.usingVirtualDom
              ? this.virtualDom
              : this.iframe.contentDocument;
            if (He(f, r)) {
              this.attachDocumentToIframe(u, f);
              return;
            }
            const d = (w, v) => {
                if (!this.usingVirtualDom) {
                  er(w);
                  for (const x of this.config.plugins || []) x.onBuild && x.onBuild(w, { id: v, replayer: this });
                }
              },
              y = ct(u.node, {
                doc: m,
                mirror: r,
                skipChild: !0,
                hackCss: !0,
                cache: this.cache,
                afterAppend: d,
              });
            if (u.previousId === -1 || u.nextId === -1) {
              i[u.node.id] = { node: y, mutation: u };
              return;
            }
            const S = r.getMeta(f);
            if (S && S.type === M.Element && u.node.type === M.Text) {
              const w = Array.isArray(f.childNodes) ? f.childNodes : Array.from(f.childNodes);
              if (S.tagName === "textarea") for (const v of w) v.nodeType === f.TEXT_NODE && f.removeChild(v);
              else if (S.tagName === "style" && w.length === 1)
                for (const v of w)
                  v.nodeType === f.TEXT_NODE && !r.hasNode(v) && ((y.textContent = v.textContent), f.removeChild(v));
            } else if ((S == null ? void 0 : S.type) === M.Document) {
              const w = f;
              u.node.type === M.DocumentType &&
                ((c = w.childNodes[0]) == null ? void 0 : c.nodeType) === Node.DOCUMENT_TYPE_NODE &&
                w.removeChild(w.childNodes[0]),
                y.nodeName === "HTML" && w.documentElement && w.removeChild(w.documentElement);
            }
            if (
              (p && p.nextSibling && p.nextSibling.parentNode
                ? f.insertBefore(y, p.nextSibling)
                : g && g.parentNode
                ? f.contains(g)
                  ? f.insertBefore(y, g)
                  : f.insertBefore(y, null)
                : f.appendChild(y),
              d(y, u.node.id),
              this.usingVirtualDom &&
                y.nodeName === "#text" &&
                f.nodeName === "STYLE" &&
                ((h = f.rules) == null ? void 0 : h.length) > 0 &&
                (f.rules = []),
              He(y, this.mirror))
            ) {
              const w = this.mirror.getId(y),
                v = this.newDocumentQueue.find((x) => x.parentId === w);
              v &&
                (this.attachDocumentToIframe(v, y),
                (this.newDocumentQueue = this.newDocumentQueue.filter((x) => x !== v)));
            }
            (u.previousId || u.nextId) && this.legacy_resolveMissingNode(i, f, y, u);
          };
        e.adds.forEach((u) => {
          a(u);
        });
        const l = Date.now();
        for (; o.length; ) {
          const u = Na(o);
          if (((o.length = 0), Date.now() - l > 500)) {
            this.warn("Timeout in the loop, please check the resolve tree data:", u);
            break;
          }
          for (const c of u)
            r.getNode(c.value.parentId)
              ? wi(c, (f) => {
                  a(f);
                })
              : this.debug("Drop resolve tree since there is no parent for the root node.", c);
        }
        Object.keys(i).length && Object.assign(this.legacy_missingNodeRetryMap, i),
          Aa(e.texts).forEach((u) => {
            var c;
            const h = r.getNode(u.id);
            if (!h) return e.removes.find((f) => f.id === u.id) ? void 0 : this.warnNodeNotFound(e, u.id);
            if (((h.textContent = u.value), this.usingVirtualDom)) {
              const f = h.parentNode;
              ((c = f == null ? void 0 : f.rules) == null ? void 0 : c.length) > 0 && (f.rules = []);
            }
          }),
          e.attributes.forEach((u) => {
            var c;
            const h = r.getNode(u.id);
            if (!h) return e.removes.find((f) => f.id === u.id) ? void 0 : this.warnNodeNotFound(e, u.id);
            for (const f in u.attributes)
              if (typeof f == "string") {
                const p = u.attributes[f];
                if (p === null) h.removeAttribute(f), f === "open" && op(h, u);
                else if (typeof p == "string")
                  try {
                    if (f === "_cssText" && (h.nodeName === "LINK" || h.nodeName === "STYLE"))
                      try {
                        const g = r.getMeta(h);
                        Object.assign(g.attributes, u.attributes);
                        const m = ct(g, {
                            doc: h.ownerDocument,
                            mirror: r,
                            skipChild: !0,
                            hackCss: !0,
                            cache: this.cache,
                          }),
                          d = h.nextSibling,
                          y = h.parentNode;
                        if (m && y) {
                          y.removeChild(h), y.insertBefore(m, d), r.replace(u.id, m);
                          break;
                        }
                      } catch (g) {}
                    if (f === "value" && h.nodeName === "TEXTAREA") {
                      const g = h;
                      g.childNodes.forEach((d) => g.removeChild(d));
                      const m = (c = h.ownerDocument) == null ? void 0 : c.createTextNode(p);
                      m && g.appendChild(m);
                    } else h.setAttribute(f, p);
                    f === "rr_open_mode" && h.nodeName === "DIALOG" && er(h, u);
                  } catch (g) {
                    this.warn("An error occurred may due to the checkout feature.", g);
                  }
                else if (f === "style") {
                  const g = p,
                    m = h;
                  for (const d in g)
                    if (g[d] === !1) m.style.removeProperty(d);
                    else if (g[d] instanceof Array) {
                      const y = g[d];
                      m.style.setProperty(d, y[0], y[1]);
                    } else {
                      const y = g[d];
                      m.style.setProperty(d, y);
                    }
                }
              }
          });
      }
      applyScroll(e, t) {
        var r, i;
        const o = this.mirror.getNode(e.id);
        if (!o) return this.debugNodeNotFound(e, e.id);
        const n = this.mirror.getMeta(o);
        if (o === this.iframe.contentDocument)
          (r = this.iframe.contentWindow) == null ||
            r.scrollTo({
              top: e.y,
              left: e.x,
              behavior: t ? "auto" : "smooth",
            });
        else if ((n == null ? void 0 : n.type) === M.Document)
          (i = o.defaultView) == null ||
            i.scrollTo({
              top: e.y,
              left: e.x,
              behavior: t ? "auto" : "smooth",
            });
        else
          try {
            o.scrollTo({
              top: e.y,
              left: e.x,
              behavior: t ? "auto" : "smooth",
            });
          } catch (a) {}
      }
      applyInput(e) {
        const t = this.mirror.getNode(e.id);
        if (!t) return this.debugNodeNotFound(e, e.id);
        try {
          (t.checked = e.isChecked), (t.value = e.text);
        } catch (r) {}
      }
      applySelection(e) {
        try {
          const t = new Set(),
            r = e.ranges.map(({ start: i, startOffset: o, end: n, endOffset: a }) => {
              const l = this.mirror.getNode(i),
                u = this.mirror.getNode(n);
              if (!l || !u) return;
              const c = new Range();
              c.setStart(l, o), c.setEnd(u, a);
              const h = l.ownerDocument,
                f = h == null ? void 0 : h.getSelection();
              return f && t.add(f), { range: c, selection: f };
            });
          t.forEach((i) => i.removeAllRanges()),
            r.forEach((i) => {
              var o;
              return i && ((o = i.selection) == null ? void 0 : o.addRange(i.range));
            });
        } catch (t) {}
      }
      applyStyleSheetMutation(e) {
        var t;
        let r = null;
        e.styleId
          ? (r = this.styleMirror.getStyle(e.styleId))
          : e.id && (r = ((t = this.mirror.getNode(e.id)) == null ? void 0 : t.sheet) || null),
          r &&
            (e.source === E.StyleSheetRule
              ? this.applyStyleSheetRule(e, r)
              : e.source === E.StyleDeclaration && this.applyStyleDeclaration(e, r));
      }
      applyStyleSheetRule(e, t) {
        var r, i, o, n;
        if (
          ((r = e.adds) == null ||
            r.forEach(({ rule: a, index: l }) => {
              try {
                if (Array.isArray(l)) {
                  const { positions: u, index: c } = _s(l);
                  Ge(t.cssRules, u).insertRule(a, c);
                } else {
                  const u = l === void 0 ? void 0 : Math.min(l, t.cssRules.length);
                  t == null || t.insertRule(a, u);
                }
              } catch (u) {}
            }),
          (i = e.removes) == null ||
            i.forEach(({ index: a }) => {
              try {
                if (Array.isArray(a)) {
                  const { positions: l, index: u } = _s(a);
                  Ge(t.cssRules, l).deleteRule(u || 0);
                } else t == null || t.deleteRule(a);
              } catch (l) {}
            }),
          e.replace)
        )
          try {
            (o = t.replace) == null || o.call(t, e.replace);
          } catch (a) {}
        if (e.replaceSync)
          try {
            (n = t.replaceSync) == null || n.call(t, e.replaceSync);
          } catch (a) {}
      }
      applyStyleDeclaration(e, t) {
        e.set && Ge(t.rules, e.index).style.setProperty(e.set.property, e.set.value, e.set.priority),
          e.remove && Ge(t.rules, e.index).style.removeProperty(e.remove.property);
      }
      applyAdoptedStyleSheet(e) {
        var t;
        const r = this.mirror.getNode(e.id);
        if (!r) return;
        (t = e.styles) == null ||
          t.forEach((a) => {
            var l;
            let u = null,
              c = null;
            if (
              (Ee(r)
                ? (c = ((l = r.ownerDocument) == null ? void 0 : l.defaultView) || null)
                : r.nodeName === "#document" && (c = r.defaultView),
              !!c)
            )
              try {
                (u = new c.CSSStyleSheet()),
                  this.styleMirror.add(u, a.styleId),
                  this.applyStyleSheetRule({ source: E.StyleSheetRule, adds: a.rules }, u);
              } catch (h) {}
          });
        const i = 10;
        let o = 0;
        const n = (a, l) => {
          const u = l.map((c) => this.styleMirror.getStyle(c)).filter((c) => c !== null);
          Ee(a) ? (a.shadowRoot.adoptedStyleSheets = u) : a.nodeName === "#document" && (a.adoptedStyleSheets = u),
            u.length !== l.length && o < i && (setTimeout(() => n(a, l), 0 + 100 * o), o++);
        };
        n(r, e.styleIds);
      }
      legacy_resolveMissingNode(e, t, r, i) {
        const { previousId: o, nextId: n } = i,
          a = o && e[o],
          l = n && e[n];
        if (a) {
          const { node: u, mutation: c } = a;
          t.insertBefore(u, r),
            delete e[c.node.id],
            delete this.legacy_missingNodeRetryMap[c.node.id],
            (c.previousId || c.nextId) && this.legacy_resolveMissingNode(e, t, u, c);
        }
        if (l) {
          const { node: u, mutation: c } = l;
          t.insertBefore(u, r.nextSibling),
            delete e[c.node.id],
            delete this.legacy_missingNodeRetryMap[c.node.id],
            (c.previousId || c.nextId) && this.legacy_resolveMissingNode(e, t, u, c);
        }
      }
      moveAndHover(e, t, r, i, o) {
        const n = this.mirror.getNode(r);
        if (!n) return this.debugNodeNotFound(o, r);
        const a = Si(n, this.iframe),
          l = e * a.absoluteScale + a.x,
          u = t * a.absoluteScale + a.y;
        (this.mouse.style.left = `${l}px`),
          (this.mouse.style.top = `${u}px`),
          i || this.drawMouseTail({ x: l, y: u }),
          this.hoverElements(n);
      }
      drawMouseTail(e) {
        if (!this.mouseTail) return;
        const {
            lineCap: t,
            lineWidth: r,
            strokeStyle: i,
            duration: o,
          } = this.config.mouseTail === !0 ? es : Object.assign({}, es, this.config.mouseTail),
          n = () => {
            if (!this.mouseTail) return;
            const a = this.mouseTail.getContext("2d");
            !a ||
              !this.tailPositions.length ||
              (a.clearRect(0, 0, this.mouseTail.width, this.mouseTail.height),
              a.beginPath(),
              (a.lineWidth = r),
              (a.lineCap = t),
              (a.strokeStyle = i),
              a.moveTo(this.tailPositions[0].x, this.tailPositions[0].y),
              this.tailPositions.forEach((l) => a.lineTo(l.x, l.y)),
              a.stroke());
          };
        this.tailPositions.push(e),
          n(),
          setTimeout(() => {
            (this.tailPositions = this.tailPositions.filter((a) => a !== e)), n();
          }, o / this.speedService.state.context.timer.speed);
      }
      hoverElements(e) {
        var t;
        (t = this.lastHoveredRootNode || this.iframe.contentDocument) == null ||
          t.querySelectorAll(".\\:hover").forEach((i) => {
            i.classList.remove(":hover");
          }),
          (this.lastHoveredRootNode = e.getRootNode());
        let r = e;
        for (; r; ) r.classList && r.classList.add(":hover"), (r = r.parentElement);
      }
      isUserInteraction(e) {
        return e.type !== I.IncrementalSnapshot ? !1 : e.data.source > E.Mutation && e.data.source <= E.Input;
      }
      backToNormal() {
        (this.nextUserInteractionEvent = null),
          !this.speedService.state.matches("normal") &&
            (this.speedService.send({ type: "BACK_TO_NORMAL" }),
            this.emitter.emit(k.SkipEnd, {
              speed: this.speedService.state.context.normalSpeed,
            }));
      }
      warnNodeNotFound(e, t) {
        this.warn(`Node with id '${t}' not found. `, e);
      }
      warnCanvasMutationFailed(e, t) {
        this.warn("Has error on canvas update", t, "canvas mutation:", e);
      }
      debugNodeNotFound(e, t) {
        this.debug(`Node with id '${t}' not found. `, e);
      }
      warn(...e) {
        this.config.showWarning && this.config.logger.warn(Wn, ...e);
      }
      debug(...e) {
        this.config.showDebug && this.config.logger.log(Wn, ...e);
      }
    }
    const { addCustomEvent: cp } = Ne,
      { freezePage: hp } = Ne,
      { takeFullSnapshot: fp } = Ne;
    exports.EventType = I;
    exports.IncrementalSource = E;
    exports.MouseInteractions = $;
    exports.Replayer = up;
    exports.ReplayerEvents = k;
    exports.addCustomEvent = cp;
    exports.canvasMutation = $s;
    exports.freezePage = hp;
    exports.record = Ne;
    exports.takeFullSnapshot = fp;
    exports.utils = md;
    if (typeof module.exports == "object" && typeof exports == "object") {
      var __cp = (to, from, except, desc) => {
        if ((from && typeof from === "object") || typeof from === "function") {
          for (let key of Object.getOwnPropertyNames(from)) {
            if (!Object.prototype.hasOwnProperty.call(to, key) && key !== except)
              Object.defineProperty(to, key, {
                get: () => from[key],
                enumerable: !(desc = Object.getOwnPropertyDescriptor(from, key)) || desc.enumerable,
              });
          }
        }
        return to;
      };
      module.exports = __cp(module.exports, exports);
    }
    return module.exports;
  });

  rrweb.record({
    emit: (event) => {
      chrome.runtime.sendMessage(
        {
          type: "SAVE_EVENTS",
          events: [event],
        },
        (response) => {
          if (!response.success) {
            console.error("[Recorder] Failed to save events:", response.error);
          }
        },
      );
    },
    sampling: {
      media: 800,
    },
    inlineImages: true,
    collectFonts: true,
    recordCrossOriginIframes: true,
    recordCanvas: true,
  });
})();

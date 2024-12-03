var rrwebRecord = (function () {
  "use strict";
  var e,
    t = function () {
      return (t =
        Object.assign ||
        function (e) {
          for (var t, n = 1, r = arguments.length; n < r; n++)
            for (var o in (t = arguments[n])) Object.prototype.hasOwnProperty.call(t, o) && (e[o] = t[o]);
          return e;
        }).apply(this, arguments);
    };
  !(function (e) {
    (e[(e.Document = 0)] = "Document"),
      (e[(e.DocumentType = 1)] = "DocumentType"),
      (e[(e.Element = 2)] = "Element"),
      (e[(e.Text = 3)] = "Text"),
      (e[(e.CDATA = 4)] = "CDATA"),
      (e[(e.Comment = 5)] = "Comment");
  })(e || (e = {}));
  var n = 1;
  var r = /url\((['"]|)([^'"]*)\1\)/gm,
    o = /^(?!www\.|(?:http|ftp)s?:\/\/|[A-Za-z]:\\|\/\/).*/;
  function u(e, t) {
    return e.replace(r, function (e, n, r) {
      if (!o.test(r)) return "url('" + r + "')";
      if ("/" === r[0])
        return (
          "url('" +
          (((u = t).indexOf("//") > -1 ? u.split("/").slice(0, 3).join("/") : u.split("/")[0]).split("?")[0] + r) +
          "')"
        );
      var u,
        a = t.split("/"),
        i = r.split("/");
      a.pop();
      for (var c = 0, d = i; c < d.length; c++) {
        var s = d[c];
        "." !== s && (".." === s ? a.pop() : a.push(s));
      }
      return "url('" + a.join("/") + "')";
    });
  }
  function a(e, t) {
    var n = e.createElement("a");
    return (n.href = t), n.href;
  }
  var i = "rr-block";
  function c(t, n) {
    switch (t.nodeType) {
      case t.DOCUMENT_NODE:
        return { type: e.Document, childNodes: [] };
      case t.DOCUMENT_TYPE_NODE:
        return { type: e.DocumentType, name: t.name, publicId: t.publicId, systemId: t.systemId };
      case t.ELEMENT_NODE:
        for (
          var r = t.classList.contains(i), o = t.tagName.toLowerCase(), c = {}, d = 0, s = Array.from(t.attributes);
          d < s.length;
          d++
        ) {
          var l = s[d],
            p = l.name,
            f = l.value;
          c[p] = "src" === p || "href" === p ? a(n, f) : f;
        }
        if ("link" === o) {
          var m = Array.from(n.styleSheets).find(function (e) {
              return e.href === t.href;
            }),
            h = (function (e) {
              try {
                var t = e.rules || e.cssRules;
                return t
                  ? Array.from(t).reduce(function (e, t) {
                      return e + t.cssText;
                    }, "")
                  : null;
              } catch (e) {
                return null;
              }
            })(m);
          h && (c = { _cssText: u(h, m.href) });
        }
        if ("input" === o || "textarea" === o || "select" === o) {
          f = t.value;
          "radio" !== c.type && "checkbox" !== c.type && f ? (c.value = f) : t.checked && (c.checked = t.checked);
        }
        if ("option" === o) {
          var v = t.parentElement;
          c.value === v.value && (c.selected = t.selected);
        }
        if (r) {
          var y = t.getBoundingClientRect(),
            g = y.width,
            E = y.height;
          (c.rr_width = g + "px"), (c.rr_height = E + "px");
        }
        return {
          type: e.Element,
          tagName: o,
          attributes: c,
          childNodes: [],
          isSVG: ((I = t), "svg" === I.tagName || I instanceof SVGElement || void 0),
          needBlock: r,
        };
      case t.TEXT_NODE:
        var b = t.parentNode && t.parentNode.tagName,
          w = t.textContent,
          C = "STYLE" === b || void 0;
        return (
          C && w && (w = u(w, location.href)),
          "SCRIPT" === b && (w = "SCRIPT_PLACEHOLDER"),
          { type: e.Text, textContent: w || "", isStyle: C }
        );
      case t.CDATA_SECTION_NODE:
        return { type: e.CDATA, textContent: "" };
      case t.COMMENT_NODE:
        return { type: e.Comment, textContent: t.textContent || "" };
      default:
        return !1;
    }
    var I;
  }
  function d(t, r, o, u) {
    void 0 === u && (u = !1);
    var a = c(t, r);
    if (!a) return console.warn(t, "not serialized"), null;
    var i = Object.assign(a, { id: n++ });
    (t.__sn = i), (o[i.id] = t);
    var s = !u;
    if (
      (i.type === e.Element && ((s = s && !i.needBlock), delete i.needBlock),
      (i.type === e.Document || i.type === e.Element) && s)
    )
      for (var l = 0, p = Array.from(t.childNodes); l < p.length; l++) {
        var f = d(p[l], r, o);
        f && i.childNodes.push(f);
      }
    return i;
  }
  function s(e) {
    n = 1;
    var t = {};
    return [d(e, e, t), t];
  }
  function l(e, t, n) {
    void 0 === n && (n = document);
    var r = { capture: !0, passive: !0 };
    return (
      n.addEventListener(e, t, r),
      function () {
        return n.removeEventListener(e, t, r);
      }
    );
  }
  var p,
    f,
    m,
    h = {
      map: {},
      getId: function (e) {
        return e.__sn ? e.__sn.id : -1;
      },
      getNode: function (e) {
        return h.map[e] || null;
      },
      removeNodeFromMap: function (e) {
        var t = e.__sn && e.__sn.id;
        delete h.map[t],
          e.childNodes &&
            e.childNodes.forEach(function (e) {
              return h.removeNodeFromMap(e);
            });
      },
      has: function (e) {
        return h.map.hasOwnProperty(e);
      },
    };
  function v(e, t, n) {
    void 0 === n && (n = {});
    var r = null,
      o = 0;
    return function () {
      var u = Date.now();
      o || !1 !== n.leading || (o = u);
      var a = t - (u - o),
        i = this,
        c = arguments;
      a <= 0 || a > t
        ? (r && (window.clearTimeout(r), (r = null)), (o = u), e.apply(i, c))
        : r ||
          !1 === n.trailing ||
          (r = window.setTimeout(function () {
            (o = !1 === n.leading ? 0 : Date.now()), (r = null), e.apply(i, c);
          }, a));
    };
  }
  function y() {
    return (
      window.innerHeight ||
      (document.documentElement && document.documentElement.clientHeight) ||
      (document.body && document.body.clientHeight)
    );
  }
  function g() {
    return (
      window.innerWidth ||
      (document.documentElement && document.documentElement.clientWidth) ||
      (document.body && document.body.clientWidth)
    );
  }
  function E(e) {
    var t = [];
    return (
      Object.keys(m)
        .filter(function (e) {
          return Number.isNaN(Number(e));
        })
        .forEach(function (n) {
          var r = n.toLowerCase(),
            o = (function (t) {
              return function (n) {
                var r = h.getId(n.target),
                  o = n.clientX,
                  u = n.clientY;
                e({ type: m[t], id: r, x: o, y: u });
              };
            })(n);
          t.push(l(r, o));
        }),
      function () {
        t.forEach(function (e) {
          return e();
        });
      }
    );
  }
  !(function (e) {
    (e[(e.DomContentLoaded = 0)] = "DomContentLoaded"),
      (e[(e.Load = 1)] = "Load"),
      (e[(e.FullSnapshot = 2)] = "FullSnapshot"),
      (e[(e.IncrementalSnapshot = 3)] = "IncrementalSnapshot"),
      (e[(e.Meta = 4)] = "Meta");
  })(p || (p = {})),
    (function (e) {
      (e[(e.Mutation = 0)] = "Mutation"),
        (e[(e.MouseMove = 1)] = "MouseMove"),
        (e[(e.MouseInteraction = 2)] = "MouseInteraction"),
        (e[(e.Scroll = 3)] = "Scroll"),
        (e[(e.ViewportResize = 4)] = "ViewportResize"),
        (e[(e.Input = 5)] = "Input");
    })(f || (f = {})),
    (function (e) {
      (e[(e.MouseUp = 0)] = "MouseUp"),
        (e[(e.MouseDown = 1)] = "MouseDown"),
        (e[(e.Click = 2)] = "Click"),
        (e[(e.ContextMenu = 3)] = "ContextMenu"),
        (e[(e.DblClick = 4)] = "DblClick"),
        (e[(e.Focus = 5)] = "Focus"),
        (e[(e.Blur = 6)] = "Blur"),
        (e[(e.TouchStart = 7)] = "TouchStart"),
        (e[(e.TouchMove = 8)] = "TouchMove"),
        (e[(e.TouchEnd = 9)] = "TouchEnd");
    })(m || (m = {}));
  var b = ["INPUT", "TEXTAREA", "SELECT"],
    w = [
      [HTMLInputElement.prototype, "value"],
      [HTMLInputElement.prototype, "checked"],
      [HTMLSelectElement.prototype, "value"],
      [HTMLTextAreaElement.prototype, "value"],
    ],
    C = "rr-ignore",
    I = new WeakMap();
  function N(e) {
    function n(e) {
      var t = e.target;
      if (t && t.tagName && !(b.indexOf(t.tagName) < 0)) {
        var n = t.type;
        if ("password" !== n && !t.classList.contains(C)) {
          var o = t.value,
            u = !1;
          ("radio" !== n && "checkbox" !== n) || (u = t.checked), r(t, { text: o, isChecked: u });
          var a = t.name;
          "radio" === n &&
            a &&
            u &&
            document.querySelectorAll('input[type="radio"][name="' + a + '"]').forEach(function (e) {
              e !== t && r(e, { text: e.value, isChecked: !u });
            });
        }
      }
    }
    function r(n, r) {
      var o = I.get(n);
      if (!o || o.text !== r.text || o.isChecked !== r.isChecked) {
        I.set(n, r);
        var u = h.getId(n);
        e(t({}, r, { id: u }));
      }
    }
    var o = ["input", "change"].map(function (e) {
        return l(e, n);
      }),
      u = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    return (
      u &&
        u.set &&
        o.push.apply(
          o,
          w.map(function (e) {
            return (function e(t, n, r) {
              var o = Object.getOwnPropertyDescriptor(t, n);
              return (
                Object.defineProperty(t, n, {
                  set: function (e) {
                    var t = this;
                    setTimeout(function () {
                      r.set.call(t, e);
                    }, 0),
                      o && o.set && o.set.call(this, e);
                  },
                }),
                function () {
                  return e(t, n, o || {});
                }
              );
            })(e[0], e[1], {
              set: function () {
                n({ target: this });
              },
            });
          }),
        ),
      function () {
        o.forEach(function (e) {
          return e();
        });
      }
    );
  }
  function T(e) {
    var t,
      n,
      r =
        ((t = e.mutationCb),
        (n = new MutationObserver(function (e) {
          var n = [],
            r = [],
            o = [],
            u = [],
            a = [],
            i = new Set(),
            c = function (e) {
              i.add(e),
                e.childNodes.forEach(function (e) {
                  return c(e);
                });
            };
          e.forEach(function (e) {
            var t = e.type,
              u = e.target,
              d = e.oldValue,
              s = e.addedNodes,
              l = e.removedNodes,
              p = e.attributeName;
            switch (t) {
              case "characterData":
                (f = u.textContent) !== d && n.push({ value: f, node: u });
                break;
              case "attributes":
                var f;
                if ((f = u.getAttribute(p)) === d) return;
                var m = r.find(function (e) {
                  return e.node === u;
                });
                m || ((m = { node: u, attributes: {} }), r.push(m)), (m.attributes[p] = f);
              case "childList":
                s.forEach(function (e) {
                  return c(e);
                }),
                  l.forEach(function (e) {
                    i.has(e)
                      ? (i.delete(e), a.push(e))
                      : (i.has(u) && !h.getId(e)) || o.push({ parentId: h.getId(u), id: h.getId(e) }),
                      h.removeNodeFromMap(e);
                  });
            }
          }),
            (o = o.map(function (e) {
              return e.parentNode && ((e.parentId = h.getId(e.parentNode)), delete e.parentNode), e;
            })),
            Array.from(i).forEach(function (e) {
              var t = h.getId(e.parentNode);
              !t ||
              a.some(function (t) {
                return t === e.parentNode;
              }) ||
              o.some(function (e) {
                return e.id === t;
              })
                ? a.push(e)
                : u.push({
                    parentId: h.getId(e.parentNode),
                    previousId: e.previousSibling ? h.getId(e.previousSibling) : e.previousSibling,
                    nextId: e.nextSibling ? h.getId(e.nextSibling) : e.nextSibling,
                    node: d(e, document, h.map, !0),
                  });
            }),
            t({
              texts: n
                .map(function (e) {
                  return { id: h.getId(e.node), value: e.value };
                })
                .filter(function (e) {
                  return h.has(e.id);
                }),
              attributes: r
                .map(function (e) {
                  return { id: h.getId(e.node), attributes: e.attributes };
                })
                .filter(function (e) {
                  return h.has(e.id);
                }),
              removes: o,
              adds: u,
            });
        })).observe(document, {
          attributes: !0,
          attributeOldValue: !0,
          characterData: !0,
          characterDataOldValue: !0,
          childList: !0,
          subtree: !0,
        }),
        n),
      o = (function (e) {
        var t,
          n = [],
          r = v(function () {
            var r = Date.now() - t;
            e(
              n.map(function (e) {
                return (e.timeOffset -= r), e;
              }),
            ),
              (n = []),
              (t = null);
          }, 500);
        return l(
          "mousemove",
          v(
            function (e) {
              var o = e.clientX,
                u = e.clientY,
                a = e.target;
              t || (t = Date.now()), n.push({ x: o, y: u, id: h.getId(a), timeOffset: Date.now() - t }), r();
            },
            20,
            { trailing: !1 },
          ),
        );
      })(e.mousemoveCb),
      u = E(e.mouseInteractionCb),
      a = (function (e) {
        return l(
          "scroll",
          v(function (t) {
            if (t.target) {
              var n = h.getId(t.target);
              t.target === document
                ? e({ id: n, x: document.documentElement.scrollLeft, y: document.documentElement.scrollTop })
                : e({ id: n, x: t.target.scrollLeft, y: t.target.scrollTop });
            }
          }, 100),
        );
      })(e.scrollCb),
      i = (function (e) {
        return l(
          "resize",
          v(function () {
            var t = y(),
              n = g();
            e({ width: Number(n), height: Number(t) });
          }, 200),
          window,
        );
      })(e.viewportResizeCb),
      c = N(e.inputCb);
    return function () {
      r.disconnect(), o(), u(), a(), i(), c();
    };
  }
  function D(e) {
    return t({}, e, { timestamp: Date.now() });
  }
  return function (e) {
    void 0 === e && (e = {});
    var n = e.emit;
    if (!n) throw new Error("emit function is required");
    try {
      var r = [];
      r.push(
        l("DOMContentLoaded", function () {
          n(D({ type: p.DomContentLoaded, data: {} }));
        }),
      );
      var o = function () {
        n(D({ type: p.Meta, data: { href: window.location.href, width: g(), height: y() } }));
        var e = s(document),
          o = e[0],
          u = e[1];
        if (!o) return console.warn("Failed to snapshot the document");
        (h.map = u),
          n(
            D({
              type: p.FullSnapshot,
              data: {
                node: o,
                initialOffset: { left: document.documentElement.scrollLeft, top: document.documentElement.scrollTop },
              },
            }),
          ),
          r.push(
            T({
              mutationCb: function (e) {
                return n(D({ type: p.IncrementalSnapshot, data: t({ source: f.Mutation }, e) }));
              },
              mousemoveCb: function (e) {
                return n(D({ type: p.IncrementalSnapshot, data: { source: f.MouseMove, positions: e } }));
              },
              mouseInteractionCb: function (e) {
                return n(D({ type: p.IncrementalSnapshot, data: t({ source: f.MouseInteraction }, e) }));
              },
              scrollCb: function (e) {
                return n(D({ type: p.IncrementalSnapshot, data: t({ source: f.Scroll }, e) }));
              },
              viewportResizeCb: function (e) {
                return n(D({ type: p.IncrementalSnapshot, data: t({ source: f.ViewportResize }, e) }));
              },
              inputCb: function (e) {
                return n(D({ type: p.IncrementalSnapshot, data: t({ source: f.Input }, e) }));
              },
            }),
          );
      };
      return (
        "interactive" === document.readyState || "complete" === document.readyState
          ? o()
          : r.push(
              l(
                "load",
                function () {
                  n(D({ type: p.Load, data: {} })), o();
                },
                window,
              ),
            ),
        function () {
          r.forEach(function (e) {
            return e();
          });
        }
      );
    } catch (e) {
      console.warn(e);
    }
  };
})();

let snapshots = [];

console.log("[Recorder] Setting up rrweb...");
rrwebRecord({
  emit: (event) => {
    console.log("[Recorder] Event captured:", event.type);
    snapshots.push(event);
  },
});

const LOCAL_API_URL = "http://localhost:3000/v1/events";
const FALLBACK_API_URL = "http://0.0.0.0:3000/v1/events"; // Need to point to 0.0.0.0 in some deploys
let currentApiUrl = LOCAL_API_URL;

function save() {
  if (snapshots.length > 0) {
    console.log(`[Recorder] Attempting to save ${snapshots.length} events`);
    const body = JSON.stringify({
      events: snapshots,
    });

    console.log("[Recorder] Saving events to", currentApiUrl);
    fetch(currentApiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body,
    })
      .then((response) => {
        console.log("[Recorder] Save response status:", response.status);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        console.log("[Recorder] Events saved successfully");
        snapshots = [];
      })
      .catch((error) => {
        console.error("[Recorder] Failed to save events:", error.toString());
        if (currentApiUrl === LOCAL_API_URL) {
          console.log("[Recorder] Switching to fallback URL");
          currentApiUrl = FALLBACK_API_URL;
          // Retry with the new URL
          save();
        }
      });
  }
}
console.log("[Recorder] Setting up save interval...");
setInterval(save, 1000);
console.log("[Recorder] Adding beforeunload handler...");
window.addEventListener("beforeunload", save);
console.log("[Recorder] Initialization complete");

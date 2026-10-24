const NOT_TYPED = [
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
];

const PICKERS = ["date", "datetime-local", "month", "time", "week"];

const FOCUSED = `(element) => {
  if (!element.isConnected) {
    return false;
  }
  const active = element.getRootNode().activeElement || null;
  return active === element || (active !== null && active.isContentEditable && active.contains(element));
}`;

export const FOCUS = `function () {
  this.focus();
  return (${FOCUSED})(this);
}`;

export const PREPARE_EDIT = `function (replace) {
  const input = this instanceof HTMLInputElement;
  if (input && ${JSON.stringify(NOT_TYPED)}.includes(this.type)) {
    return { refused: "not_editable" };
  }
  const field = input || this instanceof HTMLTextAreaElement;
  if (replace && !field && !this.isContentEditable) {
    return { refused: "not_editable" };
  }
  if (field && this.matches(":disabled")) {
    return { refused: "disabled" };
  }
  if (field && this.readOnly) {
    return { refused: "read_only" };
  }
  if (input && ${JSON.stringify(PICKERS)}.includes(this.type)) {
    return { picker: true };
  }
  const placed = (${FOCUSED})(this);
  let end = false;
  this.focus();
  if (!this.isConnected) {
    return { refused: "detached" };
  }
  if (replace && field) {
    this.select();
  } else if (field && !placed) {
    try {
      this.setSelectionRange(this.value.length, this.value.length);
    } catch {
      end = true;
    }
  } else if (this.isContentEditable && (replace || !placed)) {
    const range = this.ownerDocument.createRange();
    range.selectNodeContents(this);
    if (!replace) {
      range.collapse(false);
    }
    const selection = this.ownerDocument.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }
  if (!(${FOCUSED})(this)) {
    return { refused: "not_focused" };
  }
  return { empty: field ? this.value === "" : this.textContent === "", end };
}`;

export const SET_PICKER = `function (value) {
  const before = this.value;
  this.value = value;
  if (value !== "" && this.value === "") {
    this.value = before;
    return false;
  }
  if (this.value !== before) {
    this.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    this.dispatchEvent(new Event("change", { bubbles: true }));
  }
  return true;
}`;

export const TOGGLE_INPUT = `function () {
  const toggle = (node) =>
    node instanceof HTMLInputElement && (node.type === "checkbox" || node.type === "radio") ? node : null;
  if (toggle(this)) {
    return this;
  }
  if (this instanceof HTMLLabelElement) {
    return toggle(this.control);
  }
  const inside = this.querySelectorAll('input[type="checkbox"], input[type="radio"]');
  if (inside.length === 1) {
    return inside[0];
  }
  const label = this.closest("label");
  return label ? toggle(label.control) : null;
}`;

export const INPUT_STATE = `function () {
  return { checked: this.indeterminate ? "mixed" : this.checked, radio: this.type === "radio" };
}`;

export const SELECT = `function (wanted) {
  if (!(this instanceof HTMLSelectElement)) {
    return { refused: "not_select" };
  }
  if (this.matches(":disabled")) {
    return { refused: "disabled" };
  }
  const tidy = (text) =>
    String(text == null ? "" : text).replace(/[\\u200B-\\u200D\\u2060\\uFEFF]/g, "").replace(/\\s+/g, " ").trim();
  const options = Array.from(this.options);
  const picked = [];
  for (const value of wanted) {
    const byValue = options.filter((option) => option.value === value);
    const byLabel = options.filter((option) => tidy(option.label) === tidy(value) || tidy(option.text) === tidy(value));
    const byCase = options.filter((option) => tidy(option.label).toLowerCase() === tidy(value).toLowerCase());
    const found = byValue.length > 0 ? byValue.slice(0, 1) : byLabel.length > 0 ? byLabel : byCase;
    if (found.length === 0) {
      return { missing: value, options: options.slice(0, 30).map((option) => [option.value, tidy(option.label)]) };
    }
    if (found.length > 1) {
      return { ambiguous: value };
    }
    const option = found[0];
    if (option.matches(":disabled")) {
      return { blocked: value };
    }
    if (!picked.includes(option)) {
      picked.push(option);
    }
  }
  if (!this.multiple && picked.length > 1) {
    return { single: picked.length };
  }
  const before = options.map((option) => option.selected);
  if (this.multiple) {
    for (const option of options) {
      option.selected = picked.includes(option);
    }
  } else {
    picked[0].selected = true;
  }
  const changed = options.some((option, index) => option.selected !== before[index]);
  if (changed) {
    this.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    this.dispatchEvent(new Event("change", { bubbles: true }));
  }
  return { selected: picked.map((option) => option.value), changed };
}`;

export const SCROLL_ELEMENT = `function (dx, dy) {
  const before = [this.scrollLeft, this.scrollTop];
  this.scrollBy({ left: dx, top: dy, behavior: "instant" });
  return [...before, this.scrollLeft, this.scrollTop];
}`;

export const SCROLL_WINDOW = `function (dx, dy) {
  const before = [window.scrollX, window.scrollY];
  window.scrollBy({ left: dx, top: dy, behavior: "instant" });
  return [...before, window.scrollX, window.scrollY];
}`;

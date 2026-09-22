import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  applyAliasValidation,
  cleanAliasInput,
  isVerifyAliasDisabled,
  resetAliasVerificationUi,
  setAliasMessage,
  validateAlias,
} from "../src/identidad/identidad.js";

function makeClassList(initial = []) {
  const values = new Set(initial);

  return {
    add(name) {
      values.add(name);
    },
    remove(name) {
      values.delete(name);
    },
    toggle(name, force) {
      if (force) {
        values.add(name);
        return true;
      }

      values.delete(name);
      return false;
    },
    contains(name) {
      return values.has(name);
    },
  };
}

function makeElement({ value = "", hidden = true } = {}) {
  const attrs = {};

  return {
    value,
    textContent: "",
    disabled: false,
    classList: makeClassList(hidden ? ["hidden"] : []),
    setAttribute(name, nextValue) {
      attrs[name] = String(nextValue);
    },
    getAttribute(name) {
      return attrs[name];
    },
  };
}

function makeUi(value) {
  return {
    inputAlias: makeElement({ value, hidden: false }),
    aliasErrorMsg: makeElement(),
    aliasSuccessMsg: makeElement(),
    btnVerifyAlias: makeElement({ hidden: false }),
  };
}

test("validateAlias accepts valid .xec aliases", () => {
  for (const alias of ["xolosarmy.xec", "fernando-rmz.xec", "guardian8.xec"]) {
    assert.deepEqual(validateAlias(alias), { valid: true, normalized: alias });
  }
});

test("cleanAliasInput normalizes case, trims edges, and removes unsafe characters", () => {
  assert.equal(cleanAliasInput("XolosArmy.XEC"), "xolosarmy.xec");
  assert.equal(cleanAliasInput(" xolosarmy.xec "), "xolosarmy.xec");
  assert.equal(cleanAliasInput("xolos army.xec"), "xolos army.xec");
  assert.equal(
    cleanAliasInput("<script>alert(1)</script>"),
    "scriptalert1script",
  );
});

test("validateAlias rejects invalid aliases before backend verification", () => {
  for (const alias of [
    ".xec",
    "-xolos.xec",
    "xolos-.xec",
    "xolos..army.xec",
    "xolosarmy",
    "xolosarmy.com",
    "<script>alert(1)</script>",
    "",
    "xolos army.xec",
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.xec",
  ]) {
    assert.equal(validateAlias(alias).valid, false, alias);
  }
});

test("applyAliasValidation exposes invalid non-empty alias accessibly", () => {
  const ui = makeUi("xolosarmy");

  applyAliasValidation(ui, { walletConnected: true });

  assert.equal(ui.aliasErrorMsg.classList.contains("hidden"), false);
  assert.equal(ui.inputAlias.getAttribute("aria-invalid"), "true");
  assert.equal(ui.btnVerifyAlias.disabled, true);
});

test("applyAliasValidation leaves empty alias neutral", () => {
  const ui = makeUi("");

  applyAliasValidation(ui, { walletConnected: true });

  assert.equal(ui.aliasErrorMsg.classList.contains("hidden"), true);
  assert.equal(ui.aliasErrorMsg.textContent, "");
  assert.equal(ui.inputAlias.getAttribute("aria-invalid"), "false");
  assert.equal(ui.btnVerifyAlias.disabled, true);
});

test("applyAliasValidation hides error and enables verification for connected valid alias", () => {
  const ui = makeUi("XolosArmy.XEC");

  const validation = applyAliasValidation(ui, { walletConnected: true });

  assert.equal(validation.valid, true);
  assert.equal(validation.normalized, "xolosarmy.xec");
  assert.equal(ui.inputAlias.value, "xolosarmy.xec");
  assert.equal(ui.aliasErrorMsg.classList.contains("hidden"), true);
  assert.equal(ui.inputAlias.getAttribute("aria-invalid"), "false");
  assert.equal(ui.btnVerifyAlias.disabled, false);
});

test("alias messages use alert only for errors and status for success", () => {
  const element = makeElement();

  setAliasMessage(element, "Alias inválido", "error");
  assert.equal(element.textContent, "Alias inválido");
  assert.equal(element.getAttribute("role"), "alert");
  assert.equal(element.classList.contains("hidden"), false);

  setAliasMessage(element, "Alias verificado correctamente.", "status");
  assert.equal(element.textContent, "Alias verificado correctamente.");
  assert.equal(element.getAttribute("role"), "status");
});

test("verification button state requires wallet, valid alias, and idle verification", () => {
  assert.equal(
    isVerifyAliasDisabled({ walletConnected: false, aliasValid: true }),
    true,
  );
  assert.equal(
    isVerifyAliasDisabled({ walletConnected: true, aliasValid: false }),
    true,
  );
  assert.equal(
    isVerifyAliasDisabled({
      walletConnected: true,
      aliasValid: true,
      verificationInProgress: true,
    }),
    true,
  );
  assert.equal(
    isVerifyAliasDisabled({ walletConnected: true, aliasValid: true }),
    false,
  );
});

test("disconnect-like reset clears alias UI and disables verification", () => {
  const ui = makeUi("fernando-rmz.xec");
  applyAliasValidation(ui, { walletConnected: true });
  assert.equal(ui.btnVerifyAlias.disabled, false);

  ui.aliasSuccessMsg.textContent = "Alias verificado correctamente.";
  ui.aliasSuccessMsg.classList.remove("hidden");

  resetAliasVerificationUi(ui);

  assert.equal(ui.inputAlias.value, "");
  assert.equal(ui.inputAlias.getAttribute("aria-invalid"), "false");
  assert.equal(ui.aliasErrorMsg.classList.contains("hidden"), true);
  assert.equal(ui.btnVerifyAlias.disabled, true);
});

test("identity HTML exposes accessible alias controls", () => {
  const html = readFileSync(
    new URL("../identidad/index.html", import.meta.url),
    "utf8",
  );
  const inputTag =
    html.match(/<input[\s\S]*?id="input-alias"[\s\S]*?>/)?.[0] ?? "";
  const buttonTag =
    html.match(/<button[\s\S]*?id="btn-verify-alias"[\s\S]*?>/)?.[0] ?? "";
  const errorTag =
    html.match(/<p[\s\S]*?id="alias-error-msg"[\s\S]*?>/)?.[0] ?? "";
  const successTag =
    html.match(/<p[\s\S]*?id="alias-success-msg"[\s\S]*?>/)?.[0] ?? "";

  assert.match(inputTag, /type="text"/);
  assert.match(inputTag, /autocomplete="off"/);
  assert.match(inputTag, /spellcheck="false"/);
  assert.match(inputTag, /inputmode="text"/);
  assert.match(inputTag, /required/);
  assert.equal(
    inputTag.includes('pattern="^[a-z0-9][a-z0-9-]{1,62}\\.xec$"'),
    true,
  );
  assert.match(
    inputTag,
    /aria-describedby="alias-helper alias-error-msg alias-success-msg"/,
  );
  assert.match(inputTag, /aria-invalid="false"/);
  assert.match(buttonTag, /type="button"/);
  assert.match(buttonTag, /disabled/);
  assert.match(errorTag, /role="alert"/);
  assert.match(successTag, /role="status"/);
  assert.match(successTag, /aria-live="polite"/);
  assert.match(html, /id="alias-helper"/);
  assert.match(html, /No se solicitará una\s+firma/);
});

test("identity infrastructure links to Tonalli Memo instead of the Telegram bot", () => {
  const html = readFileSync(
    new URL("../identidad/index.html", import.meta.url),
    "utf8",
  );

  assert.match(html, /href="https:\/\/app\.tonalli\.cash\/memo"/);
  assert.doesNotMatch(html, /href="https:\/\/t\.me\/xolosArmybot"/);
});

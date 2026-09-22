import UniversalProvider from "@walletconnect/universal-provider";
import { WalletConnectModal } from "@walletconnect/modal";
import { ChronikClient } from "chronik-client";
import {
  getRMZAccessStatus,
  isValidEcashAddress,
  normalizeEcashAddress,
  resolveAlias,
} from "@xolosarmy/tonalli-core";

const PROJECT_ID = "d8772b58056b6812d57c181501dd854c";
const CHRONIK_URL = "https://chronik.xolosarmy.xyz";
const ECASH_CHAIN = "ecash:1";
const REPUTATION_API_BASE = "https://reputation.ecash.mx/v1/reputation";
const ASSEMBLY_RESULTS_URL =
  "https://assembly.ecash.mx/v1/assembly/proposals/rmz-b3-001/results";
const ASSEMBLY_VOTES_URL =
  "https://assembly.ecash.mx/v1/assembly/proposals/rmz-b3-001/votes";

const REPUTATION_TIER_LABELS = {
  identity: "Identidad",
  guardian: "Guardianía",
  governance: "Gobernanza",
  citizenship: "Ciudadanía",
};

const WALLETCONNECT_METADATA = {
  name: "Identidad RMZ",
  description: "Dashboard de identidad cultural de eCash México",
  url: "https://ecash.mx/identidad/",
  icons: ["https://ecash.mx/favicon.svg"],
};

const ECASH_NAMESPACE = {
  ecash: {
    chains: [ECASH_CHAIN],
    methods: [
      "ecash_getAddresses",
      "ecash_signMessage",
      "ecash_signAndBroadcastTransaction",
      "ecash_signAndBroadcast",
    ],
    events: ["accountsChanged", "chainChanged"],
  },
};

class ChronikAdapter {
  constructor(chronikUrl) {
    this.chronik = new ChronikClient([chronikUrl]);
  }

  async getTokenBalance(address, tokenId) {
    const result = await this.chronik.address(address).utxos();
    const utxos = this.extractUtxos(result);
    let totalAmount = 0n;

    for (const utxo of utxos) {
      const utxoTokenId = this.readTokenId(utxo);
      if (utxoTokenId !== tokenId) continue;

      const amount = this.readTokenAmount(utxo);
      if (amount === null) continue;

      totalAmount += amount;
    }

    if (totalAmount === 0n) return null;
    return { tokenId, amount: totalAmount.toString() };
  }

  extractUtxos(result) {
    if (Array.isArray(result)) return result;
    if (Array.isArray(result?.scriptUtxos)) {
      return result.scriptUtxos.flatMap(
        (scriptUtxo) => scriptUtxo?.utxos ?? [],
      );
    }
    if (Array.isArray(result?.utxos)) return result.utxos;
    return [];
  }

  readTokenId(utxo) {
    return (
      utxo?.token?.tokenId ??
      utxo?.slpMeta?.tokenId ??
      utxo?.slpToken?.tokenId ??
      null
    );
  }

  readTokenAmount(utxo) {
    const amount =
      utxo?.token?.atoms ?? utxo?.token?.amount ?? utxo?.slpToken?.amount;

    if (amount === undefined || amount === null) return null;

    try {
      return BigInt(amount.toString());
    } catch {
      return null;
    }
  }
}

function normalizeEcashAccount(account) {
  if (!account || typeof account !== "string") {
    throw new Error("WalletConnect account is empty or invalid.");
  }

  const trimmed = account.trim();

  if (trimmed.startsWith("ecash:q") || trimmed.startsWith("ecash:p")) {
    return trimmed;
  }

  const lastEcashIndex = trimmed.lastIndexOf("ecash:");
  if (lastEcashIndex >= 0) {
    return trimmed.slice(lastEcashIndex);
  }

  const parts = trimmed.split(":");
  const lastPart = parts[parts.length - 1];

  if (lastPart?.startsWith("q") || lastPart?.startsWith("p")) {
    return `ecash:${lastPart}`;
  }

  throw new Error(`Unable to normalize eCash account: ${account}`);
}

function getFirstEcashAccount(session) {
  const directAccounts = session?.namespaces?.ecash?.accounts ?? [];
  if (directAccounts.length > 0) return directAccounts[0];

  const namespaceEntry = Object.entries(session?.namespaces ?? {}).find(
    ([namespace, value]) =>
      namespace.startsWith("ecash") && Array.isArray(value?.accounts),
  );

  return namespaceEntry?.[1]?.accounts?.[0] ?? null;
}

function extractFirstWalletAddress(response) {
  if (Array.isArray(response)) return response[0] ?? null;
  if (typeof response?.address === "string") return response.address;
  if (Array.isArray(response?.addresses)) return response.addresses[0] ?? null;
  if (Array.isArray(response?.result)) return response.result[0] ?? null;
  if (typeof response?.result?.address === "string") {
    return response.result.address;
  }
  if (Array.isArray(response?.result?.addresses)) {
    return response.result.addresses[0] ?? null;
  }
  return null;
}

function normalizeAddressForCompare(address) {
  return String(address || "")
    .trim()
    .toLowerCase();
}

function normalizeVerifiedAlias(alias) {
  const normalized = String(alias || "")
    .trim()
    .toLowerCase();

  if (!normalized) return "";
  return normalized.endsWith(".xec") ? normalized : `${normalized}.xec`;
}

function formatEvidenceValue(value) {
  if (value === undefined || value === null || value === "") return null;
  return String(value);
}

export const ALIAS_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}\.xec$/;

export function cleanAliasInput(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.\-\s]/g, "");
}

export function validateAlias(value) {
  const raw = String(value || "");
  const trimmed = raw.trim();

  if (!trimmed) {
    return { valid: false, normalized: "", reason: "empty" };
  }

  if (/\s/.test(trimmed)) {
    return {
      valid: false,
      normalized: cleanAliasInput(trimmed),
      reason: "spaces",
    };
  }

  if (/[^a-zA-Z0-9.-]/.test(trimmed)) {
    return {
      valid: false,
      normalized: cleanAliasInput(trimmed),
      reason: "characters",
    };
  }

  const normalized = cleanAliasInput(trimmed);

  if (!normalized || normalized === ".xec") {
    return { valid: false, normalized, reason: "empty" };
  }

  if (!normalized.endsWith(".xec")) {
    return { valid: false, normalized, reason: "suffix" };
  }

  if (normalized.includes("..")) {
    return { valid: false, normalized, reason: "dots" };
  }

  if (normalized.startsWith("-")) {
    return { valid: false, normalized, reason: "leading-hyphen" };
  }

  const label = normalized.slice(0, -4);

  if (!label || label.length < 2) {
    return { valid: false, normalized, reason: "empty" };
  }

  if (label.endsWith("-")) {
    return { valid: false, normalized, reason: "trailing-hyphen" };
  }

  if (label.length > 63 || normalized.length > 67) {
    return { valid: false, normalized, reason: "length" };
  }

  if (!ALIAS_PATTERN.test(normalized)) {
    return { valid: false, normalized, reason: "format" };
  }

  return { valid: true, normalized };
}

export function isVerifyAliasDisabled({
  walletConnected = false,
  aliasValid = false,
  verificationInProgress = false,
} = {}) {
  return !walletConnected || !aliasValid || verificationInProgress;
}

export function setAliasMessage(element, message, tone = "status") {
  element.textContent = message;
  element.setAttribute("role", tone === "error" ? "alert" : "status");
  element.classList.toggle("hidden", !message);
}

export function applyAliasValidation(ui, options = {}) {
  const cleaned = cleanAliasInput(ui.inputAlias.value);

  if (ui.inputAlias.value !== cleaned) {
    ui.inputAlias.value = cleaned;
  }

  const validation = validateAlias(cleaned);
  const hasValue = cleaned !== "";
  const isInvalid = hasValue && !validation.valid;

  ui.inputAlias.setAttribute("aria-invalid", isInvalid ? "true" : "false");
  ui.aliasErrorMsg.classList.toggle("hidden", !isInvalid);

  if (isInvalid && !ui.aliasErrorMsg.textContent) {
    setAliasMessage(
      ui.aliasErrorMsg,
      "Escribe un alias .xec válido, por ejemplo xolosarmy.xec.",
      "error",
    );
  }

  if (!isInvalid) {
    ui.aliasErrorMsg.textContent = "";
  }

  ui.btnVerifyAlias.disabled = isVerifyAliasDisabled({
    walletConnected: options.walletConnected,
    aliasValid: validation.valid,
    verificationInProgress: options.verificationInProgress,
  });

  return validation;
}

export function resetAliasVerificationUi(ui) {
  ui.inputAlias.value = "";
  ui.inputAlias.setAttribute("aria-invalid", "false");
  setAliasMessage(ui.aliasErrorMsg, "", "error");
  setAliasMessage(ui.aliasSuccessMsg, "", "status");
  ui.btnVerifyAlias.disabled = true;
  ui.btnVerifyAlias.textContent = "Verificar";
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    console.debug("[RMZ Identity] Browser polyfills:", {
      hasBuffer: typeof globalThis.Buffer !== "undefined",
      hasGlobal: typeof globalThis.global !== "undefined",
      hasProcess: typeof globalThis.process !== "undefined",
    });

    const ui = {
      connectButton: document.getElementById("btn-connect"),
      disconnectButton: document.getElementById("btn-disconnect"),
      disconnectedState: document.getElementById("state-disconnected"),
      connectedState: document.getElementById("state-connected"),
      alias: document.getElementById("ui-alias"),
      address: document.getElementById("ui-address"),
      rmzStatus: document.getElementById("ui-rmz-status"),
      memoStatus: document.getElementById("ui-memo-status"),
      faucetStatus: document.getElementById("ui-faucet-status"),
      votingStatus: document.getElementById("ui-voting-status"),
      reputationSection: document.getElementById("reputation-section"),
      reputationStatus: document.getElementById("reputation-status"),
      reputationBadges: document.getElementById("reputation-badges"),
      reputationEvidence: document.getElementById("reputation-evidence"),
    };

    const aliasSetupSection = document.getElementById("alias-setup-section");
    const inputAlias = document.getElementById("input-alias");
    const btnVerifyAlias = document.getElementById("btn-verify-alias");
    const aliasErrorMsg = document.getElementById("alias-error-msg");
    const aliasSuccessMsg = document.getElementById("alias-success-msg");

    if (
      !ui.connectButton ||
      !ui.disconnectButton ||
      !ui.disconnectedState ||
      !ui.connectedState ||
      !ui.alias ||
      !ui.address ||
      !ui.rmzStatus ||
      !ui.memoStatus ||
      !ui.faucetStatus ||
      !ui.votingStatus ||
      !ui.reputationSection ||
      !ui.reputationStatus ||
      !ui.reputationBadges ||
      !ui.reputationEvidence ||
      !aliasSetupSection ||
      !inputAlias ||
      !btnVerifyAlias ||
      !aliasErrorMsg ||
      !aliasSuccessMsg
    ) {
      console.warn("[RMZ Identity] Missing expected identity UI elements.");
      return;
    }

    let provider;
    const modal = new WalletConnectModal({ projectId: PROJECT_ID });
    const adapter = new ChronikAdapter(CHRONIK_URL);
    let currentConnectedAddress = "";
    let reputationRequestId = 0;
    let aliasVerificationInProgress = false;

    const aliasUi = {
      inputAlias,
      btnVerifyAlias,
      aliasErrorMsg,
      aliasSuccessMsg,
    };

    const updateAliasVerificationState = () =>
      applyAliasValidation(aliasUi, {
        walletConnected:
          Boolean(currentConnectedAddress) && !inputAlias.disabled,
        verificationInProgress: aliasVerificationInProgress,
      });

    const ensureAliasInputEditable = () => {
      inputAlias.disabled = false;
      inputAlias.readOnly = false;
      inputAlias.removeAttribute("disabled");
      inputAlias.removeAttribute("readonly");
      inputAlias.classList.remove("pointer-events-none");
      aliasSetupSection.classList.remove("pointer-events-none");
      aliasSetupSection.classList.remove("hidden");
      updateAliasVerificationState();

      console.debug("[RMZ Identity] Alias input editable:", {
        disabled: inputAlias?.disabled,
        readOnly: inputAlias?.readOnly,
      });
    };

    const getAliasStorageKey = (address) =>
      `rmzIdentityAlias:${String(address || "").trim()}`;

    const getSavedAlias = (address) => {
      try {
        const saved = localStorage.getItem(getAliasStorageKey(address));
        if (!saved) return null;

        const parsed = JSON.parse(saved);
        if (
          parsed?.alias &&
          normalizeAddressForCompare(parsed.address) ===
            normalizeAddressForCompare(address)
        ) {
          return parsed;
        }
      } catch (error) {
        console.warn("[RMZ Identity] Unable to read saved alias:", error);
      }

      return null;
    };

    const saveVerifiedAlias = (address, alias) => {
      try {
        localStorage.setItem(
          getAliasStorageKey(address),
          JSON.stringify({
            alias,
            address,
            verifiedAt: new Date().toISOString(),
          }),
        );
      } catch (error) {
        console.warn("[RMZ Identity] Unable to save verified alias:", error);
      }
    };

    const setConnectLoading = (isLoading) => {
      ui.connectButton.disabled = isLoading;
      ui.connectButton.textContent = isLoading
        ? "Conectando..."
        : "Conectar Tonalli Wallet";
    };

    const reputationStatusClass = (state) => {
      const base = "space-mono rounded-md border bg-black/35 px-4 py-2 text-xs";
      const variants = {
        empty: "border-white/10 text-gray-400",
        loading: "border-cyan-500/30 text-cyan-400",
        loaded: "border-emerald-300/30 text-emerald-100",
        unavailable: "border-yellow-200/30 text-yellow-100",
        mismatch: "border-red-200 text-red-400",
      };

      return `${base} ${variants[state] ?? variants.empty}`;
    };

    const clearReputationDetails = () => {
      ui.reputationBadges.replaceChildren();
      ui.reputationEvidence.replaceChildren();
      ui.reputationEvidence.classList.add("hidden");
    };

    const setReputationState = (state, message, options = {}) => {
      if (options.hidden) {
        ui.reputationSection.classList.add("hidden");
      } else {
        ui.reputationSection.classList.remove("hidden");
      }

      ui.reputationStatus.className = reputationStatusClass(state);
      ui.reputationStatus.textContent = message;

      if (options.clear !== false) clearReputationDetails();
    };

    const resetReputation = (options = {}) => {
      reputationRequestId += 1;
      setReputationState(
        "empty",
        "Verifica tu alias .xec para cargar tus medallas.",
        options,
      );
    };

    const createEvidenceLink = (href, label) => {
      const link = document.createElement("a");
      link.href = href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.className =
        "break-all text-cyan-400 transition hover:text-emerald-200";
      link.textContent = label;
      return link;
    };

    const appendEvidenceRow = (container, label, value, href = null) => {
      const formattedValue = formatEvidenceValue(value);
      if (formattedValue === null) return;

      const row = document.createElement("p");
      row.className = "space-mono mt-1 break-all text-xs text-emerald-100";

      const labelNode = document.createElement("span");
      labelNode.className = "text-gray-500";
      labelNode.textContent = `${label}: `;
      row.append(labelNode);

      if (href) {
        row.append(createEvidenceLink(href, formattedValue));
      } else {
        row.append(document.createTextNode(formattedValue));
      }

      container.append(row);
    };

    const appendBadgeEvidence = (container, evidence) => {
      if (!evidence || typeof evidence !== "object") return;

      const evidenceNode = document.createElement("div");
      evidenceNode.className =
        "mt-4 border-t border-white/10 pt-3 text-[11px] leading-5";

      const title = document.createElement("p");
      title.className = "space-mono text-[10px] uppercase text-gray-500";
      title.textContent = "Evidencia";
      evidenceNode.append(title);

      for (const [key, value] of Object.entries(evidence)) {
        if (value === undefined || value === null || value === "") continue;
        appendEvidenceRow(evidenceNode, key, value);
      }

      if (evidenceNode.childElementCount > 1) container.append(evidenceNode);
    };

    const renderReputationBadges = (badges) => {
      ui.reputationBadges.replaceChildren();

      if (!Array.isArray(badges) || badges.length === 0) {
        const empty = document.createElement("p");
        empty.className =
          "rounded-md border border-white/10 bg-black/35 p-4 text-sm text-gray-400";
        empty.textContent = "Esta identidad no tiene medallas publicadas.";
        ui.reputationBadges.append(empty);
        return;
      }

      for (const badge of badges) {
        const earned = badge?.earned === true;
        const card = document.createElement("article");
        card.className = earned
          ? "rounded-md border border-emerald-300/30 bg-emerald-300/10 p-4 shadow-[0_0_22px_rgba(52,211,153,0.10)]"
          : "rounded-md border border-white/10 bg-white/[0.03] p-4 opacity-75";

        const meta = document.createElement("div");
        meta.className = "flex flex-wrap items-center gap-2";

        const tier = document.createElement("span");
        tier.className =
          "space-mono rounded-sm border border-cyan-500/20 bg-cyan-500/10 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-cyan-400";
        tier.textContent =
          REPUTATION_TIER_LABELS[badge?.tier] ?? badge?.tier ?? "Reputación";

        const status = document.createElement("span");
        status.className = earned
          ? "space-mono rounded-sm border border-emerald-300/30 bg-emerald-300/10 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-emerald-100"
          : "space-mono rounded-sm border border-white/10 bg-black/30 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-gray-400";
        status.textContent = earned ? "Ganada" : "Pendiente";

        meta.append(tier, status);

        const title = document.createElement("h3");
        title.className = "mt-4 text-lg font-bold text-white";
        title.textContent = badge?.label ?? badge?.id ?? "Medalla RMZ";

        const description = document.createElement("p");
        description.className = "mt-2 text-sm leading-6 text-gray-400";
        description.textContent =
          badge?.description ?? "Medalla de reputación RMZ.";

        card.append(meta, title, description);
        appendBadgeEvidence(card, badge?.evidence);
        ui.reputationBadges.append(card);
      }
    };

    const renderReputationEvidence = (reputation) => {
      const evidence = reputation?.evidence ?? {};
      const aliasRecord = evidence.aliasRecord ?? {};
      const rmz = evidence.rmz ?? {};
      const assembly = evidence.assembly ?? {};
      const latestVote =
        assembly.latestEffectiveVote ??
        assembly.latestVote ??
        assembly.vote ??
        null;

      ui.reputationEvidence.replaceChildren();

      const title = document.createElement("p");
      title.className =
        "space-mono text-[10px] font-bold uppercase tracking-[0.22em] text-cyan-400";
      title.textContent = "Evidencia compacta";
      ui.reputationEvidence.append(title);

      appendEvidenceRow(
        ui.reputationEvidence,
        "alias txid",
        aliasRecord.txid,
        aliasRecord.txid
          ? `https://explorer.xolosarmy.xyz/tx/${aliasRecord.txid}`
          : null,
      );
      appendEvidenceRow(
        ui.reputationEvidence,
        "blockheight",
        aliasRecord.blockheight ?? aliasRecord.blockHeight,
      );
      appendEvidenceRow(
        ui.reputationEvidence,
        "RMZ atoms",
        rmz.atoms ?? reputation?.rmzAtoms,
      );
      appendEvidenceRow(
        ui.reputationEvidence,
        "latest voteId",
        latestVote?.voteId,
        latestVote?.voteId ? ASSEMBLY_VOTES_URL : null,
      );
      appendEvidenceRow(
        ui.reputationEvidence,
        "latest choiceId",
        latestVote?.choiceId,
        latestVote?.choiceId ? ASSEMBLY_RESULTS_URL : null,
      );

      ui.reputationEvidence.classList.toggle(
        "hidden",
        ui.reputationEvidence.childElementCount <= 1,
      );
    };

    const loadReputationForAlias = async (alias) => {
      const verifiedAlias = normalizeVerifiedAlias(alias);
      const connectedWallet = normalizeAddressForCompare(
        currentConnectedAddress,
      );

      if (!verifiedAlias || !connectedWallet) {
        resetReputation();
        return;
      }

      const requestId = reputationRequestId + 1;
      reputationRequestId = requestId;
      setReputationState("loading", "Cargando reputación RMZ...");

      try {
        const response = await fetch(
          `${REPUTATION_API_BASE}/${encodeURIComponent(verifiedAlias)}`,
          { headers: { Accept: "application/json" } },
        );

        if (requestId !== reputationRequestId) return;

        if (response.status === 404) {
          setReputationState(
            "unavailable",
            "Esta identidad aún no tiene reputación registrada.",
          );
          return;
        }

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const reputation = await response.json();
        const responseAlias = normalizeVerifiedAlias(reputation?.alias);
        const responseWallet = normalizeAddressForCompare(reputation?.wallet);

        if (responseAlias !== verifiedAlias) {
          setReputationState(
            "unavailable",
            "No se pudo cargar reputation.ecash.mx en este momento.",
          );
          return;
        }

        if (responseWallet !== connectedWallet) {
          setReputationState(
            "mismatch",
            "La reputación no corresponde a la wallet conectada.",
          );
          return;
        }

        setReputationState("loaded", "Reputación cargada.", { clear: false });
        renderReputationBadges(reputation.badges);
        renderReputationEvidence(reputation);
      } catch (error) {
        if (requestId !== reputationRequestId) return;
        console.error("[RMZ Identity] Reputation load failed.", error);
        setReputationState(
          "unavailable",
          "No se pudo cargar reputation.ecash.mx en este momento.",
        );
      }
    };

    const showDisconnected = () => {
      ui.connectedState.classList.add("hidden");
      ui.disconnectedState.classList.remove("hidden");
      ui.disconnectedState.classList.add("block");
      ui.alias.textContent = "Wallet desconectada";
      ui.address.textContent = "ecash:...";
      ui.rmzStatus.textContent = "No verificado";
      ui.memoStatus.textContent = "Disponible";
      ui.faucetStatus.textContent = "Limitada";
      ui.votingStatus.textContent = "Requiere alias verificado";
      currentConnectedAddress = "";
      resetReputation({ hidden: true });
      aliasVerificationInProgress = false;
      resetAliasVerificationUi(aliasUi);
      aliasSetupSection.classList.add("hidden");
      inputAlias.disabled = true;
      inputAlias.readOnly = false;
      inputAlias.setAttribute("disabled", "");
      inputAlias.removeAttribute("readonly");
      setConnectLoading(false);
    };

    const showConnected = () => {
      ui.disconnectedState.classList.add("hidden");
      ui.disconnectedState.classList.remove("block");
      ui.connectedState.classList.remove("hidden");
    };

    const clearAliasMessages = () => {
      setAliasMessage(aliasErrorMsg, "", "error");
      setAliasMessage(aliasSuccessMsg, "", "status");
    };

    const showAliasError = (message) => {
      setAliasMessage(aliasErrorMsg, message, "error");
      setAliasMessage(aliasSuccessMsg, "", "status");
      inputAlias.setAttribute("aria-invalid", "true");
    };

    const showAliasSuccess = (message) => {
      setAliasMessage(aliasSuccessMsg, message, "status");
      setAliasMessage(aliasErrorMsg, "", "error");
      inputAlias.setAttribute("aria-invalid", "false");
    };

    const resetAliasVerification = () => {
      aliasVerificationInProgress = false;
      resetAliasVerificationUi(aliasUi);
      aliasSetupSection.classList.add("hidden");
      inputAlias.disabled = true;
      inputAlias.readOnly = false;
      inputAlias.setAttribute("disabled", "");
      inputAlias.removeAttribute("readonly");
    };

    const applyHolderStatus = (address, status) => {
      ui.address.textContent = address;
      ui.votingStatus.textContent = "Requiere alias verificado";
      aliasSetupSection.classList.add("hidden");

      if (status === "holder") {
        ui.alias.textContent = "Guardián RMZ";
        ui.rmzStatus.textContent = "Guardián RMZ";
        ui.memoStatus.textContent = "Disponible";
        ui.faucetStatus.textContent = "Desbloqueada";
        resetReputation();
        ensureAliasInputEditable();
        btnVerifyAlias.textContent = "Verificar";
        return;
      }

      if (status === "error") {
        ui.alias.textContent = "Wallet conectada";
        ui.rmzStatus.textContent = "Error de red";
        ui.memoStatus.textContent = "Disponible";
        ui.faucetStatus.textContent = "Limitada";
        return;
      }

      resetReputation({ hidden: true });
      ui.alias.textContent = "Wallet conectada";
      ui.rmzStatus.textContent = "No verificado";
      ui.memoStatus.textContent = "Disponible";
      ui.faucetStatus.textContent = "Limitada";
    };

    const handleAliasVerification = async () => {
      if (aliasVerificationInProgress) return;

      clearAliasMessages();
      const validation = updateAliasVerificationState();

      if (!currentConnectedAddress) {
        showAliasError("Conecta Tonalli Wallet antes de verificar tu alias.");
        return;
      }

      if (!validation.valid) {
        showAliasError(
          "Escribe un alias .xec válido, por ejemplo xolosarmy.xec.",
        );
        return;
      }

      aliasVerificationInProgress = true;
      btnVerifyAlias.disabled = true;
      btnVerifyAlias.textContent = "Verificando...";
      showAliasSuccess("Verificando...");

      try {
        const resolution = await resolveAlias(validation.normalized, {
          endpoint: "https://alias.ecash.mx",
        });

        if (resolution === null) {
          showAliasError("Alias no registrado en eCash.");
          return;
        }

        if (!resolution?.address) {
          showAliasError(
            "No se pudo consultar el servidor de aliases. Intenta de nuevo.",
          );
          return;
        }

        const resolvedAddress = normalizeAddressForCompare(resolution.address);
        const connectedAddress = normalizeAddressForCompare(
          currentConnectedAddress,
        );

        if (resolvedAddress !== connectedAddress) {
          showAliasError("Este alias no corresponde a la wallet conectada.");
          return;
        }

        const verifiedAlias = validateAlias(resolution.alias).valid
          ? validateAlias(resolution.alias).normalized
          : validation.normalized;
        ui.alias.textContent = verifiedAlias;
        inputAlias.value = verifiedAlias;
        saveVerifiedAlias(currentConnectedAddress, verifiedAlias);
        showAliasSuccess("Alias verificado correctamente.");
        ui.votingStatus.textContent = "Disponible";
        loadReputationForAlias(verifiedAlias);
        console.debug("[RMZ Identity] Alias verified.");
      } catch (error) {
        console.error("[RMZ Identity] Alias verification failed.", {
          message: error?.message,
        });
        showAliasError(
          "No se pudo consultar el servidor de aliases. Intenta de nuevo.",
        );
      } finally {
        aliasVerificationInProgress = false;
        btnVerifyAlias.textContent = "Verificar";
        updateAliasVerificationState();
      }
    };

    const getPrimaryWalletAccount = async (session) => {
      try {
        const walletAddresses = await provider.request({
          method: "ecash_getAddresses",
          params: {},
        });
        return (
          extractFirstWalletAddress(walletAddresses) ??
          getFirstEcashAccount(session)
        );
      } catch (error) {
        console.debug("[RMZ Identity] ecash_getAddresses failed.", error);
        return getFirstEcashAccount(session);
      }
    };

    const restoreVerifiedAlias = (address) => {
      const savedAlias = getSavedAlias(address);
      if (!savedAlias) return;

      const verifiedAlias = normalizeVerifiedAlias(savedAlias.alias);
      ui.alias.textContent = verifiedAlias;
      inputAlias.value = verifiedAlias;
      showAliasSuccess("Alias verificado anteriormente.");
      ui.votingStatus.textContent = "Disponible";
      loadReputationForAlias(verifiedAlias);
    };

    const handleAccount = async (rawAccount, options = {}) => {
      const address = normalizeEcashAddress(normalizeEcashAccount(rawAccount));

      console.debug("[RMZ Identity] WalletConnect account:", rawAccount);
      console.debug("[RMZ Identity] Normalized eCash address:", address);
      console.debug(
        "[RMZ Identity] Account restored:",
        Boolean(options.restored),
      );
      console.debug(
        "[RMZ Identity] isValidEcashAddress:",
        isValidEcashAddress(address),
      );

      if (!isValidEcashAddress(address)) {
        throw new Error(`Invalid eCash address from wallet: ${address}`);
      }

      showConnected();
      resetAliasVerification();
      resetReputation({ hidden: true });
      ui.address.textContent = address;
      ui.alias.textContent = "Verificando RMZ...";
      ui.rmzStatus.textContent = "Verificando...";
      ui.memoStatus.textContent = "Disponible";
      ui.faucetStatus.textContent = "Verificando...";
      ui.votingStatus.textContent = "Requiere alias verificado";

      const status = await getRMZAccessStatus(address, adapter);
      currentConnectedAddress = address;
      applyHolderStatus(address, status);

      if (status === "holder") {
        restoreVerifiedAlias(address);
        ensureAliasInputEditable();
      }
    };

    const restoreWalletSession = async () => {
      console.debug(
        "[RMZ Identity] Session restored:",
        Boolean(provider?.session),
      );
      if (!provider?.session) return;

      try {
        console.debug("[RMZ Identity] Restoring WalletConnect session.");
        const rawAccount = await getPrimaryWalletAccount(provider.session);
        if (!rawAccount) return;
        await handleAccount(rawAccount, { restored: true });
      } catch (error) {
        console.warn(
          "[RMZ Identity] Unable to restore WalletConnect session:",
          error,
        );
      }
    };

    const initializeProvider = async () => {
      provider = await UniversalProvider.init({
        projectId: PROJECT_ID,
        metadata: WALLETCONNECT_METADATA,
      });

      provider.on("display_uri", (uri) => {
        modal.openModal({ uri });
      });

      provider.on("session_delete", showDisconnected);
      provider.on("disconnect", showDisconnected);
      provider.on("accountsChanged", async () => {
        if (!provider?.session) return;
        try {
          const rawAccount = await getPrimaryWalletAccount(provider.session);
          if (rawAccount) await handleAccount(rawAccount);
        } catch (error) {
          console.error("[RMZ Identity] Unable to refresh account.", error);
          showDisconnected();
        }
      });

      await restoreWalletSession();
    };

    ui.connectButton.addEventListener("click", async () => {
      setConnectLoading(true);

      try {
        if (!provider) await initializeProvider();

        const session = await provider.connect({ namespaces: ECASH_NAMESPACE });
        modal.closeModal();

        if (!session)
          throw new Error("WalletConnect did not return a session.");

        try {
          const rawAccount = await getPrimaryWalletAccount(session);
          if (!rawAccount) {
            throw new Error("WalletConnect did not return an eCash account.");
          }
          await handleAccount(rawAccount);
        } catch (error) {
          console.error("[RMZ Identity] Invalid wallet address.", error);
          alert("La wallet devolvió una dirección eCash inválida.");
          showDisconnected();
        }
      } catch (error) {
        modal.closeModal();
        console.error("[RMZ Identity] WalletConnect failed.", error);
        alert("No se pudo conectar Tonalli Wallet. Intenta de nuevo.");
        showDisconnected();
      } finally {
        setConnectLoading(false);
      }
    });

    if (btnVerifyAlias) {
      btnVerifyAlias.addEventListener("click", handleAliasVerification);
    }

    inputAlias.addEventListener("input", () => {
      clearAliasMessages();
      updateAliasVerificationState();
    });

    inputAlias.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !btnVerifyAlias.disabled) {
        handleAliasVerification();
      }
    });

    ui.disconnectButton.addEventListener("click", async () => {
      try {
        if (provider?.session) {
          await provider.disconnect();
        }
      } catch (error) {
        console.error("[RMZ Identity] Disconnect failed.", error);
      } finally {
        showDisconnected();
      }
    });

    initializeProvider().catch((error) => {
      console.error("[RMZ Identity] WalletConnect init failed.", error);
      showDisconnected();
    });
  });
}

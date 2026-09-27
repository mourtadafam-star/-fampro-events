((globalScope) => {
  function normalizeSenegalWhatsAppPhone(value) {
    const raw = String(value ?? "").trim();
    if (!raw || /[a-z]/i.test(raw)) return "";

    let digits = raw.replace(/\D/g, "");
    if (digits.startsWith("00")) digits = digits.slice(2);
    if (digits.startsWith("2210") && digits.length === 13) {
      digits = `221${digits.slice(4)}`;
    }
    if (digits.startsWith("0") && digits.length === 10) digits = digits.slice(1);
    if (digits.length === 9) digits = `221${digits}`;
    return /^221\d{9}$/.test(digits) ? digits : "";
  }

  globalScope.FAMproSharing = Object.freeze({ normalizeSenegalWhatsAppPhone });
})(globalThis);

/** Escape text for embedding in abort/error HTML. */
function escapeHtml(text) {
  return String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export { escapeHtml };

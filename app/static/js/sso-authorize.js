(async () => {
  const query = new URLSearchParams(location.search);
  const request = {client_id: query.get("client_id"), redirect_uri: query.get("redirect_uri"), code_challenge: query.get("code_challenge")};
  const callback = "https://sdgs-attendance-record.vercel.app/auth/sso/callback";
  const status = document.getElementById("status");
  if (request.client_id !== "attendance" || request.redirect_uri !== callback || !/^[A-Za-z0-9_-]{43}$/.test(request.code_challenge || "") || !/^[A-Za-z0-9_-]{32,128}$/.test(query.get("state") || "")) {
    status.textContent = "登入連結無效，請從課程登錄重新開始。"; return;
  }
  const signIn = () => location.replace("/?sso_return=" + encodeURIComponent(location.pathname + location.search));
  const token = localStorage.getItem("sdgs_token");
  if (!token) { signIn(); return; }
  try {
    const response = await fetch("/api/auth/sso/ticket", {method:"POST", headers:{"Content-Type":"application/json",Authorization:"Bearer " + token}, body:JSON.stringify(request)});
    if (response.status === 401) { localStorage.removeItem("sdgs_token"); signIn(); return; }
    if (!response.ok) throw new Error();
    const data = await response.json();
    const destination = new URL(callback);
    destination.searchParams.set("code", data.code);
    destination.searchParams.set("state", query.get("state"));
    location.replace(destination.href);
  } catch { status.textContent = "目前無法完成登入，請稍後再從課程登錄重試。"; }
})();

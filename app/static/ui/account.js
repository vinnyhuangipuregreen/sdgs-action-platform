// Presentation only: read the existing platform session without transferring it to other apps.
async function displayAccount() {
  try {
    const token = localStorage.getItem('sdgs_token');
    if (!token) return;
    const response = await fetch('/api/auth/me', {headers:{Authorization:'Bearer ' + token},cache:'no-store'});
    if (!response.ok) return;
    const user = await response.json();
    document.getElementById('currentUserName').textContent = user.name;
    document.getElementById('currentUserRole').textContent = {admin:'系統管理員',teacher:'講師',student:'學員'}[user.role] || '訪客模式';
  } catch (error) {
    // Unavailable third-party storage keeps the guest display; authentication is unchanged.
  }
}
displayAccount();
window.addEventListener('storage', displayAccount);

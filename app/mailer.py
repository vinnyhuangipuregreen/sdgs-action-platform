import os
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime
from app.database import get_db

DEFAULT_BACKUP_EMAIL = "vinnyhuang.ipuregreen@gmail.com"

def send_grade_notification(ws: dict, score: int, comment: str) -> dict:
    student_name = ws.get("user_name", "學員")
    unit_name = ws.get("unit_name", "佛光學員")
    worksheet_id = ws.get("id")
    # Send directly to the student's email as requested
    recipient = ws.get("email") or ws.get("user_email") or DEFAULT_BACKUP_EMAIL
    
    subject = f"【佛光永續學院】SDGs 與氣候行動連動分析練習單 — 審查評定與導師指導評語通知（學員：{student_name}）"
    
    act_names = {"A": "A．一次淨灘", "B": "B．社區二手衣物交換", "C": "C．道場或家裡改用太陽能", "D": "D．自選佛光活動"}
    center_title = act_names.get(ws.get("center_action"), ws.get("center_action", "標準行動"))
    if ws.get("center_custom"):
        center_title += f"（{ws.get('center_custom')}）"

    html_content = f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {{ font-family: 'Helvetica Neue', Helvetica, Arial, 'PingFang TC', 'Microsoft JhengHei', sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #1e293b; }}
    .container {{ max-width: 660px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.05); }}
    .header {{ background: linear-gradient(135deg, #059669 0%, #0d9488 100%); color: #ffffff; padding: 36px 28px; text-align: center; }}
    .header h1 {{ margin: 0; font-size: 24px; font-weight: 800; letter-spacing: 0.5px; }}
    .header p {{ margin: 8px 0 0 0; font-size: 13px; opacity: 0.95; }}
    .content {{ padding: 32px 28px; line-height: 1.7; font-size: 14.5px; }}
    .score-card {{ background: #f5f3ff; border: 1px solid #ddd6fe; border-radius: 14px; padding: 22px; text-align: center; margin: 24px 0; }}
    .score-badge {{ font-size: 36px; font-weight: 900; color: #6d28d9; margin: 6px 0; }}
    .comment-box {{ background: #f8fafc; border-left: 4px solid #059669; padding: 16px; border-radius: 6px; margin: 18px 0; font-size: 14px; color: #334155; line-height: 1.6; }}
    .info-table {{ width: 100%; border-collapse: collapse; margin: 18px 0; font-size: 13.5px; }}
    .info-table td {{ padding: 10px 14px; border-bottom: 1px solid #f1f5f9; }}
    .info-table td.label {{ font-weight: bold; width: 32%; color: #64748b; background-color: #f8fafc; }}
    .footer {{ background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 22px 28px; text-align: center; font-size: 12px; color: #94a3b8; }}
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div style="font-size: 32px; margin-bottom: 8px;">🌏</div>
      <h1>SDGs 與氣候行動｜連動分析練習單</h1>
      <p>佛光永續學院 × 佛光大學應用科技與設計學院 ｜ 專題研習成果通知</p>
    </div>
    <div class="content">
      <p>親愛的 <strong>{student_name}</strong> 學員 您好：</p>
      <p>感謝您用心參與本次「SDGs 與氣候行動：連動分析」專題研習！授課講師 <strong>戴慶華 博士 (Dr. ANDERSON)</strong> 與教學評審團隊已完成您所提交之練習單審查與指導評定。</p>
      
      <div class="score-card">
        <div style="font-size: 12px; font-weight: bold; color: #7c3aed; letter-spacing: 1px; text-transform: uppercase;">審閱評定成績</div>
        <div class="score-badge">{score} <span style="font-size: 18px; font-weight: normal; color: #6b7280;">/ 100 分</span></div>
        <div style="font-size: 12.5px; color: #64748b; font-weight: 500;">深入剖析放射型連動與善意拉扯檢核，成果優異！</div>
      </div>

      <h3 style="font-size: 16px; color: #0f172a; margin-top: 26px; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px;">📝 導師指導講評與回饋意見</h3>
      <div class="comment-box">
        {comment or '分析邏輯嚴謹，具體闡明了行動所觸發的作用機制與可觀察變化，善意拉扯檢核兼具務實的風險對策，成果卓越！'}
      </div>

      <h3 style="font-size: 16px; color: #0f172a; margin-top: 26px; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px;">📋 練習單核心內容摘要</h3>
      <table class="info-table">
        <tr>
          <td class="label">學員姓名 / 單位</td>
          <td><strong>{student_name}</strong> ｜ {unit_name}</td>
        </tr>
        <tr>
          <td class="label">中心行動選擇</td>
          <td><strong>{center_title}</strong></td>
        </tr>
        <tr>
          <td class="label">聊天室代碼</td>
          <td style="font-family: monospace; color: #0284c7; font-weight: bold;">{ws.get('chat_text', '無')}</td>
        </tr>
      </table>

      <p style="margin-top: 22px; font-size: 13.5px; color: #475569;">
        期勉您持續在日常生活與分會活動中實踐「我的連動承諾」，不僅列出 SDGs 目標編號，更以具體行動引發正向漣漪效應，並留意善意拉扯的潛在風險。
      </p>
    </div>
    <div class="footer">
      <p style="font-weight: bold; color: #64748b;">佛光永續學院 × 佛光大學應用科技與設計學院 ｜ 教學指導團隊 敬上</p>
      <p style="margin-top: 6px;">本信件由「SDGs 與氣候行動連動分析平台」系統自動發送（收件信箱：{recipient}）</p>
    </div>
  </div>
</body>
</html>
"""

    text_content = f"""【佛光永續學院】SDGs 與氣候行動連動分析練習單 — 審查評定與導師指導評語通知

親愛的 {student_name} 學員 您好：

感謝您參與佛光永續學院 × 佛光大學應用科技與設計學院之「SDGs 與氣候行動連動分析」研習。
講師 戴慶華 博士 (Dr. ANDERSON) 已完成您的練習單審閱！

【審核成績】：{score} 分 / 100 分
【學員姓名】：{student_name} ({unit_name})
【中心行動】：{center_title}
【導師講評】：{comment or '分析邏輯清晰，各項作用機制具體明確！'}

【練習單代碼】：{ws.get('chat_text', '無')}

期勉您持續落實連動承諾，引領更多青年發揮永續影響力！

佛光永續學院 × 佛光大學應用科技與設計學院 教學團隊 敬上
(通知收件信箱: {recipient})
"""

    sent = False
    error = "尚未設定通知信服務，請設定 SMTP_HOST、SMTP_USER 與 SMTP_PASSWORD。"
    smtp_host = os.environ.get("SMTP_HOST")
    smtp_user = os.environ.get("SMTP_USER")
    smtp_pass = os.environ.get("SMTP_PASSWORD")
    if smtp_host and smtp_user and smtp_pass:
        try:
            port = int(os.environ.get("SMTP_PORT", 587))
            msg = MIMEMultipart("alternative")
            msg["Subject"] = subject
            msg["From"] = smtp_user
            msg["To"] = recipient
            msg.attach(MIMEText(text_content, "plain", "utf-8"))
            msg.attach(MIMEText(html_content, "html", "utf-8"))
            
            smtp = smtplib.SMTP_SSL if port == 465 else smtplib.SMTP
            with smtp(smtp_host, port, timeout=10) as server:
                if port != 465:
                    server.starttls()
                server.login(smtp_user, smtp_pass)
                server.sendmail(smtp_user, [recipient], msg.as_string())
            sent = True
            error = ""
        except Exception as e:
            print("Grade notification SMTP failed:", type(e).__name__)
            error = "通知信寄送失敗，請檢查寄信服務設定後重試。"

    try:
        with get_db() as conn:
            conn.execute("""
            INSERT INTO system_email_logs (worksheet_id, recipient, student_name, subject, score, comment, status)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (worksheet_id, recipient, student_name, subject, score, comment, "success" if sent else "failed"))
    except Exception as e:
        print("Grade notification log failed:", type(e).__name__)

    return {
        "success": sent,
        "error": error,
        "recipient": recipient,
        "subject": subject,
        "sent_at": datetime.now().isoformat() if sent else None
    }

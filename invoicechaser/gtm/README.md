# InvoiceChaser — ערכת Concierge (השגת 3 הלקוחות הראשונים)

המטרה של התיקייה הזו: להמיר את **מנוע-הגבייה** (`../core/`) ל**הכנסה ראשונה** —
בלי לבנות עוד תוכנה, ובלי קהל קיים. זוהי תוכנית-הפעולה ל-Phase 0 (אימות) מתוך
[`../docs/10-roadmap-risks-compliance.md`](../docs/10-roadmap-risks-compliance.md).

## הרעיון בקצרה

> אתה ניגש ל-3 בעלי-סוכנויות, מציע להם **"ניתוח-גבייה חינם"**, מריץ את המנוע על
> ה-CSV שלהם, ומחזיר להם **דוח-שחזור-תזרים** מקצועי (HTML) שמראה כמה כסף תקוע
> וכמה אפשר לגבות מהר. ואז אתה מציע: **"אני אגבה את זה בשבילך — ותשלם לי רק
> אחוז ממה שייגבה".** אפס-סיכון להם, כסף-מהר לך.

## הקבצים

| קובץ | מה זה |
|------|--------|
| [`01-offer-and-playbook.md`](01-offer-and-playbook.md) | ההצעה + תוכנית 14 יום צעד-אחר-צעד לסגירת לקוח ראשון |
| [`02-outreach-templates.md`](02-outreach-templates.md) | טמפלייטים מוכנים: מייל קר, LinkedIn, WhatsApp, פולואפים (he+en) |
| [`03-pricing-and-agreement.md`](03-pricing-and-agreement.md) | מודל success-fee, הגדרת-ייחוס הוגנת, ותבנית-הסכם פשוטה |

## איך מפיקים את הדוח ללקוח (הנשק)

```bash
cd ../core
# מקבלים מהסוכנות CSV של חשבוניות פתוחות (id,customerName,customerEmail,amount,currency,issueDate,dueDate,status,lang)
node src/report-cli.mjs <agency-invoices.csv> agency-report.html
# שולחים את agency-report.html — זה ה"ניתוח-גבייה החינמי"
```

(דוגמה מוכנה: `../core/samples/sample-report.html`)

## מדד-ההצלחה של Phase 0
לסגור **2–3 סוכנויות** ולגבות **לפחות חשבונית אחת** דרך המנוע (אפילו בשליחה
ידנית) — זו ההוכחה שצריך לפני שבונים את מעטפת-ה-web. אם זה קורה: בונים. אם לא:
מבינים אם הבעיה היא הטון, הייחוס, או הקהל — לפני שמשקיעים עוד.

# 09 · ארכיטקטורה טכנית

ארכיטקטורת-יעד למוצר רזה, מאובטח וניתן-לבנייה-סולו. אין כאן קוד — תכנון בלבד.
ההמלצות הן ברירת-מחדל הגיונית; ניתן להחליף רכיבים.

## 9.1 עקרונות
- **רזה ומהיר ל-MVP:** monolith מודולרי, פחות תשתית, ערך מהר.
- **Event-driven לגבייה:** כל אירוע (תזכורת נשלחה/נצפתה/שולם) נרשם — בסיס למעקב,
  ללמידה, ול-success-fee.
- **AI מאחורי ממשק אחיד:** ניתן-להחלפה, עם logging מלא.
- **Security & tone-safety by design:** הודעות נשלחות בשם-הלקוח → סינון ואישור.

## 9.2 Tech Stack מומלץ

| שכבה | בחירה | חלופות |
|------|--------|---------|
| Frontend | Next.js (React) + TypeScript | Remix |
| Backend | Next.js API routes / Node (NestJS) | Python (FastAPI) |
| DB | PostgreSQL (Supabase/Neon ל-MVP מהיר) | — |
| Queue/Scheduler | מתזמן (cron/Temporal/BullMQ) לרצף-התזכורות | — |
| אימייל | Postmark / Resend / SendGrid (transactional) | — |
| SMS/WhatsApp [V1] | Twilio / WhatsApp Business API | — |
| תשלומים | Stripe (Payment Links + webhooks) | — |
| אינטגרציות [V1] | QuickBooks / Xero API | חשבונית-ישראלית |
| AI/LLM | Claude (Anthropic) API + embeddings | — |
| Auth | Clerk / Auth.js / Supabase Auth | — |
| Hosting | Vercel + managed Postgres | — |
| Observability | Sentry + logs | — |

> **הערה ליזם-סולו:** שילוב Next.js + Supabase/Neon + Vercel + Stripe + Resend
> מאפשר לבנות את כל ה-MVP לבד, בעלות חודשית זניחה.

## 9.3 דיאגרמת-מערכת (מושגית)

```
        ┌──────────────── Web App (Next.js) ────────────────┐
        │  Dashboard · Invoices · Cadence · Reports · Settings│
        └───────────────────────┬────────────────────────────┘
                                 │ API
        ┌────────────────────────┴─────────────────────────────┐
        │                  Application Core                     │
        │  Invoices │ Cadence Engine │ AI Service │ Messaging   │
        │  Payments │ Reporting      │ Webhooks   │ Auth        │
        └───┬─────────────┬───────────────┬───────────────┬─────┘
            │             │               │               │
   ┌────────▼───┐  ┌──────▼──────┐  ┌─────▼──────┐  ┌─────▼───────┐
   │ PostgreSQL │  │ Scheduler/  │  │ LLM (Claude)│ │ Integrations│
   │ + Events   │  │ Queue       │  │ + embeddings│ │ QB/Xero/CSV │
   └────────────┘  └─────────────┘  └────────────┘  └─────────────┘
        External: Stripe (pay+webhooks) · Email/SMS/WhatsApp providers
```

## 9.4 מודל-נתונים — ישויות-ליבה

| ישות | שדות-מפתח | קשרים |
|------|-------------|--------|
| **Account** | id, business_name, brand_tone, lang, plan | 1—N User, Customer, Invoice |
| **User** | id, account_id, role, email | שייך ל-Account |
| **Customer** | id, account_id, name, contacts{email,phone}, segment | 1—N Invoice |
| **Invoice** | id, customer_id, amount, currency, issue_date, due_date, status | 1—1 Cadence, 1—N Reminder |
| **Cadence** | id, invoice_id, steps[], mode(auto/approval), state | מנהל את הרצף |
| **Reminder** | id, invoice_id, channel, content, scheduled_at, sent_at, urgency | 1—N Event |
| **Event** | id, reminder_id/invoice_id, type(sent/opened/clicked/paid), ts | אירוע בלתי-משתנה |
| **Payment** | id, invoice_id, amount, method, stripe_ref, paid_at | קושר Stripe |
| **Integration** | account_id, provider(QB/Xero), tokens, last_sync | מסנכרן Invoices |
| **ImpactSnapshot** | account_id, dso_before/after, collected_amount, period | בסיס דוח+success-fee |

עיקרון: טבלת **Event** היא event-log בלתי-משתנה — מאפשרת מעקב, חישוב-DSO,
חישוב-success-fee, ולמידת ה-AI.

## 9.5 רכיב מרכזי — Cadence Engine
- מתזמן בודק חשבוניות-פתוחות → לכל שלב-רצף שהגיע-זמנו: קורא ל-AI Service לניסוח,
  עובר Brand-safety filter, ואז שולח (או מעלה לאישור ב-Approval mode).
- Idempotency על שליחות (למנוע כפילויות); תקרת-תדירות פר-לקוח.
- עצירה אוטומטית על אירוע-עצירה (שולם / במחלוקת / תגובת-לקוח / opt-out).

## 9.6 שכבת-AI
- `generateReminder(context) → {subject, body, urgency}` — ניסוח מותאם.
- `decideNextAction(invoiceState) → {action, channel, sendAt}` — תזמון/ערוץ/הסלמה.
- סגמנטציה ב-embeddings; logging מלא של prompt/פלט/תוצאה → לולאת-למידה ([פרק 05](05-ai-dunning-engine.md)).
- Guardrails: סף-נחרצות, סינון-פלט, human-in-the-loop.

## 9.7 אבטחה ותאימות-נתונים
- הצפנה במנוחה ובתעבורה; ניהול-סודות; RBAC.
- **לא מאחסנים פרטי-תשלום** — Stripe מטפל (אין PCI-scope משמעותי).
- OAuth-tokens (QB/Xero) מוצפנים; הרשאות-מינימום.
- GDPR/פרטיות: ייצוא/מחיקה, מינימום-נתונים, ניהול-opt-out (ראו [פרק 10](10-roadmap-risks-compliance.md)).
- Deliverability: SPF/DKIM/DMARC לשליחה בשם-המשתמש; ניטור-bounce/spam.

## 9.8 היקף-בנייה ל-MVP (ל-handoff)
1. Auth + Account/User + הגדרות-מותג.
2. ייבוא CSV → Invoices + Customers.
3. Cadence Engine + Scheduler + AI generate + Email (Resend/Postmark).
4. Stripe Payment Link + webhook → Payment + סטטוס.
5. Dashboard + Aging + ImpactSnapshot.
6. Approval mode + Brand-safety filter.

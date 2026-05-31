# InvoiceChaser — Core Dunning Engine (MVP slice)

הליבה הרצה של InvoiceChaser: המנוע שמחליט **מה לשלוח, מתי, ובאיזו רמת-נחרצות** לכל
חשבונית-פתוחה, ומנסח תזכורת מותאמת — עם guardrails לבטיחות-טון. זהו הבידול המרכזי
של המוצר (ראו [`../docs/05-ai-dunning-engine.md`](../docs/05-ai-dunning-engine.md)).

**אפס תלויות. רץ עם Node בלבד — בלי `npm install`.**

## הרצה

```bash
cd invoicechaser/core

# הדגמה על חשבוניות לדוגמה (תוכנית גבייה מלאה + תזכורות מנוסחות)
node src/cli.mjs samples/invoices.csv --today=2026-05-31 --mode=auto

# בדיקות
node test/run-tests.mjs
```

`--mode=approval` (ברירת-המחדל) = הכל ממתין לאישורך לפני שליחה. `--mode=auto` =
שולח אוטומטית, אבל **הודעה אחרונה (urgency 4) תמיד דורשת אישור-אדם**.

## מה יש כאן (מיפוי לאיפיון)

| קובץ | תפקיד | פרק באיפיון |
|------|--------|--------------|
| `src/domain.mjs` | מודל-נתונים + עזרי-חישוב (DSO, כסף, לינק-תשלום) | docs/09 §9.4 |
| `src/cadence.mjs` | Cadence Engine — מחליט פעולה הבאה / רצף מתוכנן | docs/05 §5.1, docs/04 §4.2 |
| `src/generator.mjs` | ניסוח תזכורת מותאמת (he/en, לפי נחרצות) | docs/05 §5.2 |
| `src/guardrails.mjs` | בטיחות-טון: חסימת איומים, תקרת-נחרצות | docs/05 §5.4 |
| `src/ai-adapter.mjs` | תפר ל-LLM (Claude) עם fallback בטוח לתבנית | docs/05 §5.6, docs/09 §9.6 |
| `src/csv.mjs` | ייבוא CSV (אפס-תלויות) | docs/04 §4.1 |
| `src/cli.mjs` | הדגמה רצה מקצה-לקצה | — |

## עקרונות שכבר ממומשים
- **הסלמה הדרגתית** — ידידותי → נחרץ, לפי ימי-האיחור.
- **בטיחות-טון** — אף פעם לא איום/שפה משפטית; final notice דורש אישור-אדם.
- **עצירה אוטומטית** — חשבונית `paid`/`disputed` לא נרדפת.
- **רב-לשוני** — עברית/אנגלית לפי הלקוח.
- **ניסוח LLM אמיתי (Claude)** — מחובר ב-`src/llm-claude.mjs`. הגדר מפתח והכל זורם:
  ```bash
  export ANTHROPIC_API_KEY=sk-ant-...
  # אופציונלי: export INVOICECHASER_MODEL=claude-haiku-4-5-20251001  (ברירת-מחדל — זול ומהיר)
  node src/cli.mjs samples/invoices.csv --today=2026-05-31 --mode=auto
  # ה-outbox במצב-מפעיל ינוסח אוטומטית ע"י Claude:
  node src/operator-cli.mjs outbox ws.json --today=2026-05-31
  ```
  ה-**guardrails נאכפים על פלט-ה-LLM**, ואם הוא נכשל/מפר-טון/אין-רשת — **fallback
  אוטומטי ובטוח לתבנית** (אף פעם לא נשלח טקסט לא-בטוח). בלי מפתח — הכל רץ offline
  על מנוע-התבנית.

## מצב-מפעיל (Operator) — להריץ גבייה אמיתית בפאזת Concierge

המנוע לא רק "חושב" — הוא **זוכר ומודד**. מצב-המפעיל שומר workspace (קובץ JSON,
בלי שרת) שמחזיק חשבוניות + event-log, ומאפשר להריץ לולאת-גבייה ידנית מקצה-לקצה:

```bash
WS=workspace.json

# 1) ייבוא חשבוניות של סוכנות
node src/operator-cli.mjs import $WS agency.csv --name="Pixel & Co." --signer="רותם" --reply="billing@pixelco.example"

# 2) ה-Outbox של היום + ייצוא מיילים מוכנים-לשליחה (.eml)
node src/operator-cli.mjs outbox $WS --today=2026-05-31 --mode=approval --out=./outbox
#    -> פותחים את ה-.eml בלקוח-המייל, או מעתיקים מ-index.md ל-Gmail

# 3) מתעדים מה נשלח (כדי לא לשלוח שוב את אותו שלב)
node src/operator-cli.mjs sent-all $WS --today=2026-05-31

# 4) כשלקוח משלם / מתלונן
node src/operator-cli.mjs pay     $WS INV-1043 42000 --at=2026-06-04
node src/operator-cli.mjs dispute $WS INV-1046

# 5) Impact — ההוכחה + בסיס ה-success-fee
node src/operator-cli.mjs impact $WS --today=2026-06-04
```

`outbox` מדלג אוטומטית על שלב שכבר נשלח (dedupe), על חשבונית `paid`, ועל
`disputed`. `impact` מחשב כמה נגבה, כמה "מזכה" (היה באיחור כשנרדף ואז שולם),
וימים-ממוצע-עד-תשלום — בדיוק מה שצריך לחיוב ה-success-fee ([`../gtm/03`](../gtm/03-pricing-and-agreement.md)).

| קובץ נוסף | תפקיד |
|------------|--------|
| `src/store.mjs` | workspace JSON (load/save) — Postgres בעתיד |
| `src/operator.mjs` | לוגיקת-מפעיל טהורה (outbox/dedupe/impact) |
| `src/outbox-export.mjs` | ייצוא ל-.eml + index.md |
| `src/operator-cli.mjs` | CLI לפקודות import/outbox/sent/pay/impact |
| `src/report.mjs` + `report-cli.mjs` | דוח-שחזור-תזרים (HTML) ל"ניתוח חינם" |

## Dashboard (שרת web אפס-תלויות)

ממשק חזותי מעל המנוע — רץ עם `node` בלבד (מודול `http` המובנה), בלי build ובלי npm.

```bash
# (אם צריך) זרע workspace מ-CSV
node src/operator-cli.mjs import ws.json samples/invoices.csv --name="Pixel & Co." --signer="רותם"
# הפעל את הלוח
node src/server.mjs ws.json --port=3000      # → http://localhost:3000
```

הלוח מציג: KPIs (נגבה/מזכה/ימים-עד-תשלום/פתוח-באיחור), טבלת-חשבוניות עם aging,
ה-**Outbox** של היום עם תזכורות מנוסחות + כפתור "סמן כנשלח", פעולות "שולם"/"מחלוקת",
וייבוא CSV מהדפדפן. עם `ANTHROPIC_API_KEY` — ה-Outbox מנוסח ע"י Claude (אחרת תבנית).
ה-API: `GET /api/state`, `GET /api/outbox`, `POST /api/{sent,sent-all,pay,dispute,import}`.

## הצעד הבא (לא בליבה הזו)
- מעטפת web (Next.js) + DB (Postgres) לפי [`../docs/09-architecture.md`](../docs/09-architecture.md).
- שליחת-אימייל אמיתית (Resend/Postmark) + Stripe Payment Links + webhooks.
- אינטגרציית QuickBooks/Xero.
- **הערה:** סיכום ה"סך באיחור" ב-CLI מסכם מטבעות יחד לצורך הדגמה; ריבוי-מטבעות
  אמיתי הוא V1 (docs/04 §4.4).

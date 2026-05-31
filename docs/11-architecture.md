# 11 · ארכיטקטורה טכנית

מסמך זה מתאר ארכיטקטורת-יעד לבנייה אמינה, מאובטחת וניתנת-לסקייל. אין כאן קוד —
רק תכנון. ההמלצות הן ברירת-מחדל הגיונית; ניתן להחליף רכיבים.

## 11.1 עקרונות אדריכליים
- **Modular Monolith → Services:** להתחיל ב-monolith מודולרי (מהירות-פיתוח),
  ולחלץ שירותים (Escrow, Trust, Matching) כשהסקייל מצדיק.
- **Money & Trust כליבה קריטית:** שכבות התשלום והאמון נבנות עם audit-trail מלא,
  idempotency, ו-event-sourcing (כל שינוי-כסף/ציון = אירוע בלתי-משתנה).
- **AI as a service-layer:** מודולי ה-AI מאחורי ממשק אחיד, ניתנים-להחלפה, עם
  guardrails ו-fallback אנושי.
- **Privacy & Security by design:** הצפנה, מינימום-נתונים, הפרדת-סביבות.

## 11.2 Tech Stack מומלץ

| שכבה | בחירה מומלצת | חלופות |
|------|----------------|---------|
| Frontend (Web) | Next.js (React) + TypeScript | Remix |
| Mobile | React Native / Expo | Flutter |
| Backend | Node.js (NestJS) **או** Python (FastAPI) | Go (לשירותי-כסף) |
| DB ראשי | PostgreSQL | — |
| חיפוש/וקטורים (Matching) | pgvector / Pinecone / Weaviate | Elasticsearch |
| Cache/Queue | Redis + Kafka/SQS | RabbitMQ |
| תשלומים/Escrow | Stripe Connect (Custom) / שותף-Escrow מורשה | Adyen, MangoPay |
| KYC/AML | Persona / Onfido / Stripe Identity | Sumsub |
| חתימה דיגיטלית | DocuSign / Dropbox Sign API | — |
| AI/LLM | Claude (Anthropic) API + embeddings | ספקים נוספים |
| תשתית | AWS/GCP, Kubernetes/ECS, Terraform (IaC) | — |
| Observability | OpenTelemetry, Datadog/Grafana | — |

## 11.3 דיאגרמת מערכת (מושגית)

```
                   ┌─────────────── Client (Web / Mobile) ───────────────┐
                   │                  Next.js / React Native               │
                   └───────────────────────────┬──────────────────────────┘
                                                │ (HTTPS / API Gateway)
        ┌───────────────────────────────────────┴───────────────────────────┐
        │                          Application / API Layer                    │
        │  Auth/Identity │ Profiles │ Matching │ Workspace │ Deals │ Notif.   │
        └───┬──────────┬──────────┬──────────┬───────────┬──────────┬────────┘
            │          │          │          │           │          │
   ┌────────▼──┐ ┌─────▼─────┐ ┌──▼───────┐ ┌▼─────────┐ ┌▼────────┐ ┌▼──────────┐
   │ Trust     │ │ Escrow &  │ │ AI       │ │ Contracts│ │ Disputes│ │ Integr.   │
   │ Engine    │ │ Payments  │ │ Services │ │ /Sign    │ │ Engine  │ │ (GitHub/  │
   │ (Index)   │ │ (Stripe)  │ │ (LLM)    │ │          │ │         │ │  Figma)   │
   └────┬──────┘ └─────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬────┘ └─────┬─────┘
        │              │            │            │            │            │
   ┌────▼──────────────▼────────────▼────────────▼────────────▼────────────▼────┐
   │   Data: PostgreSQL (txn) │ pgvector (match) │ Redis │ Kafka (events) │ S3   │
   └──────────────────────────────────────────────────────────────────────────┘
        External: Stripe Connect · KYC (Persona) · LLM API · DocuSign
```

## 11.4 מודל נתונים — ישויות-ליבה

| ישות | שדות-מפתח | קשרים |
|------|-------------|--------|
| **User** | id, role, kyc_status, profile, tier | 1—N Deals, 1—1 TrustProfile |
| **TrustProfile** | user_id, score, components{}, badges | 1—N TrustEvent |
| **TrustEvent** | id, user_id, type, weight, value, ts | שייך ל-User/Deal |
| **Match** | id, client_id, talent_id, score, status | מוביל ל-Deal |
| **Deal** | id, track, parties, scope_id, status, gmv | 1—N Milestone |
| **Contract/Scope** | deal_id, terms, signed_at, version | 1—1 Deal |
| **Milestone** | id, deal_id, amount, due, status | 1—1 EscrowTx |
| **EscrowTx** | id, milestone_id, amount, state, release_rule | קשור Stripe |
| **VestingSchedule** | deal_id (equity), cliff, milestones, % | מסלול-Equity |
| **Dispute** | id, deal_id, claims, evidence, resolution | מעדכן Escrow+Trust |
| **Integration** | user_id, provider, tokens, last_sync | מזין Verification |

עיקרון: כל שינוי-כסף וכל שינוי-ציון נכתבים כ-**אירועים בלתי-משתנים** (event log)
לצורך audit, שחזור וחישוב-מחדש.

## 11.5 שכבת ה-AI
- **Gatekeeper/Onboarding:** LLM + מקורות-אימות; פלט מובנה (JSON) עם ציון-ביטחון.
- **Matching:** embeddings של בריפים ופרופילים ב-vector DB; דירוג היברידי
  (וקטורי + חוקים עסקיים + Trust Index).
- **Scope/Contract & Verification & Mediation:** LLM עם prompt-templates,
  retrieval מה-Workspace/integrations, ו-**guardrails**: סף-ביטחון, human-in-the-
  loop על החלטות-כסף, ולוג-החלטות מלא להסבר/ערעור.
- **בטיחות:** הזרקת-נתונים-חיצוניים (תוכן-משתמש/אינטגרציות) מטופלת כ-untrusted;
  הפרדה בין הוראות-מערכת לתוכן.

## 11.6 אבטחה ותאימות
- **PCI-DSS** דרך שותף-הסליקה (לא מאחסנים PAN); הפרדת **כספי-נאמנות**.
- **KYC/AML** בכניסה ובעסקאות-גדולות; ניטור-fraud.
- **הצפנה** במנוחה ובתעבורה; ניהול-סודות (KMS/Vault); RBAC + least-privilege.
- **GDPR/פרטיות:** מינימום-נתונים, זכות-מחיקה/ייצוא, data-residency.
- **SOC 2 Type II** כיעד-בשלות; audit-log בלתי-משתנה; DR/BCP לשכבת-הכסף.

## 11.7 סקיילביליות ואמינות
- Stateless API מאחורי load-balancer; אוטו-סקייל.
- עיבוד-אסינכרוני (Kafka) ל-AI/verification/notifications.
- idempotency-keys לכל פעולת-כסף; transactional-outbox למניעת אי-עקביות.
- SLOs: זמינות שכבת-הכסף ≥ 99.95%; latency-Matching < 1s.

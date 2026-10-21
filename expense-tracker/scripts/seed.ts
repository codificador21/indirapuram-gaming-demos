/**
 * Seeds a realistic ~7 weeks (last month + this month up to now) so the UI looks alive.
 *
 *   npm run db:seed          # refuses if transactions already exist
 *   npm run db:reset         # wipes transactions/messages/settings data, then seeds
 *
 * Everything except the cash entries goes through the real ingestion pipeline as bank SMS / email
 * text, so the seed also exercises parsing, dedupe (SMS + email copies), categorisation, salary
 * detection, fixed-commitment and self-transfer exclusion. Deterministic (seeded PRNG).
 */
import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd());

type Kind = 'sms' | 'email';
interface Event {
  at: Date;
  kind: Kind | 'cash';
  sender?: string;
  subject?: string;
  body?: string;
  cash?: { amountPaise: number; merchant: string; categoryId?: string; notes?: string };
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  const reset = process.argv.includes('--reset');
  const { sql } = await import('drizzle-orm');
  const { createDb } = await import('../src/db');
  const schema = await import('../src/db/schema');
  const { ensureDefaults } = await import('../src/lib/bootstrap');
  const { ingestMessage } = await import('../src/lib/ingest/pipeline');
  const { createTransaction } = await import('../src/lib/transactions');
  const { addDays, localDayKey, parseDayKey, zonedTimeToUtc, DEFAULT_TIMEZONE } = await import('../src/lib/time');

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set (see .env.example)');
  const tz = process.env.APP_TIMEZONE || DEFAULT_TIMEZONE;
  const { db, pool } = createDb(url);

  try {
    await ensureDefaults(db);
    const n = ((await db.execute(sql`select count(*)::int as n from transactions`)).rows[0] as { n: number } | undefined)?.n ?? 0;
    if (n > 0 && !reset) {
      console.log(`Database already has ${n} transactions — not seeding. Use \`npm run db:reset\` to wipe and re-seed.`);
      return;
    }
    if (reset) {
      await db.execute(sql`truncate raw_messages, transactions, merchant_rules, fixed_commitments, my_accounts, app_state restart identity cascade`);
      console.log('✔ wiped existing data');
    }

    // ── Settings ────────────────────────────────────────────────────────────
    await db
      .insert(schema.settings)
      .values({ id: 1, monthlySalaryPaise: 85_000_00, salaryCreditDay: 1, budgetCycle: 'calendar', selfIdentifiers: ['Aarav Mehta', 'aarav.mehta@okhdfcbank'] })
      .onConflictDoUpdate({
        target: schema.settings.id,
        set: { monthlySalaryPaise: 85_000_00, salaryCreditDay: 1, budgetCycle: 'calendar', selfIdentifiers: ['Aarav Mehta', 'aarav.mehta@okhdfcbank'] },
      });
    await db.insert(schema.fixedCommitments).values([
      { name: 'Rent', kind: 'rent', amountPaise: 22_000_00, matchKeywords: 'ramesh kumar, nobroker' },
      { name: 'Index fund SIP', kind: 'sip', amountPaise: 10_000_00, matchKeywords: 'zerodha, groww' },
      { name: 'Phone EMI', kind: 'emi', amountPaise: 3_500_00, matchKeywords: 'bajaj' },
    ]);
    await db.insert(schema.myAccounts).values([
      { label: 'HDFC savings', bank: 'HDFC', last4: '1234', type: 'bank' },
      { label: 'SBI savings', bank: 'SBI', last4: '4321', type: 'bank' },
      { label: 'Kotak savings', bank: 'KOTAK', last4: '9911', type: 'bank' },
      { label: 'ICICI Amazon Pay card', bank: 'ICICI', last4: '9876', type: 'credit_card' },
      { label: 'Axis Flipkart card', bank: 'AXIS', last4: '3344', type: 'credit_card' },
    ]);
    await db.insert(schema.merchantRules).values({ merchantKey: 'decathlon', categoryId: 'health' });

    // ── Event generation ────────────────────────────────────────────────────
    const rnd = mulberry32(20261021);
    const pick = <T,>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)]!;
    const between = (lo: number, hi: number) => Math.round(lo + rnd() * (hi - lo));
    let refCounter = 0;
    const ref = () => `62${String(Math.floor(rnd() * 1e6)).padStart(6, '0')}${String(++refCounter).padStart(4, '0')}`;
    const rs = (rupees: number) => rupees.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const now = new Date();
    const todayKey = localDayKey(now, tz);
    const t = parseDayKey(todayKey);
    const prevMonthStart = t.month === 1 ? `${t.year - 1}-12-01` : `${t.year}-${String(t.month - 1).padStart(2, '0')}-01`;
    const events: Event[] = [];
    let balance = 42_000;

    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const fmt = (key: string) => {
      const { year, month, day } = parseDayKey(key);
      const dd = String(day).padStart(2, '0');
      const mm = String(month).padStart(2, '0');
      const yy = String(year).slice(2);
      return { slash: `${dd}/${mm}/${yy}`, dash: `${dd}-${mm}-${yy}`, mon: `${dd}-${MON[month - 1]}-${yy}`, sbi: `${dd}${MON[month - 1]}${yy}`, upper: `${dd}-${MON[month - 1]!.toUpperCase()}-${yy}`, full: `${dd}-${mm}-${year}` };
    };
    const at = (key: string, hour: number, minute = between(0, 59)) => {
      const { year, month, day } = parseDayKey(key);
      return zonedTimeToUtc(year, month, day, hour, minute, between(0, 59), tz);
    };

    // Templates per instrument.
    const hdfcUpi = (key: string, when: Date, amount: number, payee: string, withEmail = false, vpa = `${payee.toLowerCase().replace(/[^a-z]/g, '')}@axisbank`) => {
      const r = ref();
      balance -= amount;
      events.push({ at: when, kind: 'sms', sender: 'VM-HDFCBK-S', body: `Sent Rs.${amount.toFixed(2)}\nFrom HDFC Bank A/C *1234\nTo ${payee}\nOn ${fmt(key).slash}\nRef ${r}\nNot You?\nCall 18002586161/SMS BLOCK UPI to 7308080808` });
      if (withEmail) {
        events.push({
          at: new Date(when.getTime() + between(40, 180) * 1000),
          kind: 'email',
          sender: 'alerts@hdfcbank.net',
          subject: '❗ You have done a UPI txn. Check details!',
          body: `Dear Customer,\n\nRs.${amount.toFixed(2)} has been debited from account **1234 to VPA ${vpa} ${payee} on ${fmt(key).dash}. Your UPI transaction reference number is ${r}.\n\nIf you did not authorize this transaction, please report it immediately.\n\nWarm Regards,\nHDFC Bank`,
        });
      }
    };
    const iciciCard = (key: string, when: Date, amount: number, merchant: string, withEmail = false) => {
      events.push({ at: when, kind: 'sms', sender: 'VK-ICICIB-S', body: `INR ${rs(amount)} spent using ICICI Bank Card XX9876 on ${fmt(key).mon} on ${merchant}. Avl Limit: INR ${rs(between(80_000, 190_000))}. If not you, call 1800 2662/SMS BLOCK 9876 to 9215676766` });
      if (withEmail) {
        const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric', year: 'numeric' }).format(when);
        const hm = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(when);
        events.push({
          at: new Date(when.getTime() + between(30, 120) * 1000),
          kind: 'email',
          sender: 'credit_cards@icicibank.com',
          subject: 'Transaction alert for your ICICI Bank Credit Card',
          body: `Dear Customer,\n\nYour ICICI Bank Credit Card XX9876 has been used for a transaction of INR ${rs(amount)} on ${p} at ${hm}. Info: ${merchant}.\n\nThe Available Credit Limit on your card is INR 1,12,340.00.`,
        });
      }
    };
    const axisCard = (key: string, when: Date, amount: number, merchant: string) => {
      const hm = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(when);
      events.push({ at: new Date(when.getTime() + 20_000), kind: 'sms', sender: 'VM-AXISBK-S', body: `Spent\nCard no. XX3344\nINR ${amount}\n${fmt(key).dash} ${hm}\n${merchant}\nAvl Lmt INR ${rs(between(60_000, 140_000))}\nSMS BLOCK 3344 to 919951860002, if not you - Axis Bank` });
    };
    const sbiUpi = (key: string, when: Date, amount: number, payee: string) => {
      events.push({ at: when, kind: 'sms', sender: 'BZ-SBIUPI-S', body: `Dear UPI user A/C X4321 debited by ${amount.toFixed(1)} on date ${fmt(key).sbi} trf to ${payee} Refno ${ref()}. If not u? call 1800111109. -SBI` });
    };
    const kotakUpi = (key: string, when: Date, amount: number, vpa: string) => {
      events.push({ at: when, kind: 'sms', sender: 'AX-KOTAKB-S', body: `Sent Rs.${amount.toFixed(2)} from Kotak Bank AC X9911 to ${vpa} on ${fmt(key).dash}.UPI Ref ${ref()}. Not you, kotak.com/fraud` });
    };

    const food = [
      { name: 'SWIGGY', lo: 180, hi: 640 },
      { name: 'ZOMATO', lo: 160, hi: 720 },
      { name: 'STARBUCKS', lo: 280, hi: 560 },
      { name: 'THIRD WAVE COFFEE', lo: 220, hi: 420 },
      { name: 'HALDIRAMS', lo: 180, hi: 520 },
      { name: 'MCDONALDS', lo: 190, hi: 450 },
    ];
    const groceries = [
      { name: 'BLINKIT', lo: 160, hi: 980 },
      { name: 'ZEPTO', lo: 140, hi: 860 },
      { name: 'SWIGGY INSTAMART', lo: 220, hi: 1250 },
      { name: 'BIGBASKET', lo: 650, hi: 2400 },
    ];
    const transport = [
      { name: 'UBER INDIA', lo: 140, hi: 480 },
      { name: 'OLA', lo: 120, hi: 420 },
      { name: 'RAPIDO', lo: 45, hi: 160 },
      { name: 'DMRC', lo: 30, hi: 60 },
    ];
    const shopping = [
      { name: 'AMAZON PAY INDIA', lo: 350, hi: 3200 },
      { name: 'FLIPKART', lo: 450, hi: 3800 },
      { name: 'MYNTRA', lo: 700, hi: 2600 },
      { name: 'DECATHLON', lo: 900, hi: 2400 },
    ];

    for (let key = prevMonthStart; key <= todayKey; key = addDays(key, 1)) {
      const { day } = parseDayKey(key);
      const isToday = key === todayKey;
      const dow = new Date(`${key}T00:00:00Z`).getUTCDay();
      const weekend = dow === 0 || dow === 6;
      const nowHour = isToday ? Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(now)) : 24;
      const push = (hour: number, fn: (when: Date) => void) => {
        if (hour < nowHour) fn(at(key, hour));
      };

      // Monthly fixed events
      if (day === 1) {
        push(9, (w) => {
          balance += 85_000;
          events.push({
            at: w,
            kind: 'sms',
            sender: 'VM-HDFCBK-S',
            body: `Update! INR 85,000.00 deposited in HDFC Bank A/c XX1234 on ${fmt(key).upper} for NEFT Cr-HDFC0000240-ACME TECHNOLOGIES PVT LTD-AARAV MEHTA-N${key.replace(/-/g, '')}4412345.Avl bal INR ${rs(balance)}. Cheque deposits in A/C are subject to clearing`,
          });
        });
      }
      if (day === 3) push(10, (w) => hdfcUpi(key, w, 22_000, 'RAMESH KUMAR'));
      if (day === 5)
        push(7, (w) =>
          events.push({ at: w, kind: 'sms', sender: 'VM-HDFCBK-S', body: `Dear Customer, Rs.10,000.00 has been debited from your HDFC Bank A/c XX1234 on ${fmt(key).dash} towards ZERODHA BROKING LTD (NACH SIP). Avl Bal INR ${rs((balance -= 10_000))}` }),
        );
      if (day === 10)
        push(7, (w) =>
          events.push({ at: w, kind: 'sms', sender: 'VM-HDFCBK-S', body: `Dear Customer, Rs.3,500.00 has been debited from your HDFC Bank A/c XX1234 on ${fmt(key).dash} towards BAJAJ FINANCE LTD (NACH EMI). Avl Bal INR ${rs((balance -= 3_500))}` }),
        );
      if (day === 7) push(21, (w) => iciciCard(key, w, 649, 'NETFLIX', true));
      if (day === 9) push(12, (w) => kotakUpi(key, w, 599, 'airtel.payments@kotak'));
      if (day === 12) {
        push(11, (w) => {
          events.push({ at: w, kind: 'sms', sender: 'VM-HDFCBK-S', body: `Money Sent - INR 10,000.00 From HDFC Bank A/c XX1234 on ${fmt(key).dash} To A/c XX4321 IMPS Ref No ${ref()} Avl bal: INR ${rs((balance -= 10_000))}` });
          events.push({ at: new Date(w.getTime() + 90_000), kind: 'sms', sender: 'CP-CBSSBI-S', body: `Your A/C XXXXX4321 Credited INR 10,000.00 on ${fmt(key).slash} -Deposit by transfer from AARAV MEHTA. Avl Bal INR 24,310.50-SBI` });
        });
      }
      if (day === 14) push(19, (w) => hdfcUpi(key, w, between(1_400, 2_200), 'TATA POWER DDL', false, 'tatapower.ddl@hdfcbank'));
      if (day === 18) {
        push(9, (w) => {
          events.push({ at: w, kind: 'sms', sender: 'VM-HDFCBK-S', body: `Rs.${rs(14_820)} debited from HDFC Bank A/c XX1234 on ${fmt(key).dash} towards ICICI BANK CREDIT CARD payment via BillDesk. Avl bal INR ${rs((balance -= 14_820))}` });
          events.push({ at: new Date(w.getTime() + 3 * 3600_000), kind: 'sms', sender: 'VK-ICICIB-S', body: `Payment of INR ${rs(14_820)} has been received on your ICICI Bank Credit Card XX9876 on ${fmt(key).mon}. Thank you.` });
        });
      }
      if (day === 20) push(16, (w) => iciciCard(key, w, 119, 'SPOTIFY'));

      // Daily-ish discretionary spending
      push(8, (w) => {
        if (rnd() < 0.55) kotakUpi(key, w, between(25, 90), pick(['chaipoint.ncr@kotak', 'chaayos.noida@ybl']));
      });
      if (!weekend) {
        push(9, (w) => rnd() < 0.7 && (rnd() < 0.5 ? sbiUpi(key, w, pick(transport).hi > 200 ? between(140, 380) : between(40, 120), pick(['UBER INDIA', 'RAPIDO', 'OLA'])) : hdfcUpi(key, w, between(30, 60), 'DMRC', false, 'dmrc.qr@hdfcbank')));
        push(19, (w) => rnd() < 0.55 && sbiUpi(key, w, between(140, 420), pick(['UBER INDIA', 'RAPIDO', 'OLA'])));
      }
      push(13, (w) => {
        if (rnd() < 0.7) {
          const m = pick(food);
          hdfcUpi(key, w, between(m.lo, m.hi), m.name, rnd() < 0.35);
        }
      });
      push(20, (w) => {
        if (rnd() < (weekend ? 0.8 : 0.45)) {
          const m = pick(food);
          if (rnd() < 0.5) iciciCard(key, w, between(m.lo, m.hi), m.name, rnd() < 0.5);
          else hdfcUpi(key, w, between(m.lo, m.hi), m.name, rnd() < 0.3);
        }
      });
      push(18, (w) => {
        if (rnd() < 0.42) {
          const m = pick(groceries);
          hdfcUpi(key, w, between(m.lo, m.hi), m.name, rnd() < 0.3);
        }
      });
      push(weekend ? 16 : 22, (w) => {
        if (rnd() < (weekend ? 0.4 : 0.12)) {
          const m = pick(shopping);
          if (m.name === 'FLIPKART' || m.name === 'MYNTRA') axisCard(key, w, between(m.lo, m.hi), m.name);
          else iciciCard(key, w, between(m.lo, m.hi), m.name, true);
        }
      });
      if (weekend) push(17, (w) => rnd() < 0.3 && iciciCard(key, w, between(350, 900), 'BOOKMYSHOW'));
      if (rnd() < 0.08) push(15, (w) => hdfcUpi(key, w, between(160, 780), 'APOLLO PHARMACY', false, 'apollopharmacy@icici'));
      if (rnd() < 0.05) push(11, (w) => hdfcUpi(key, w, between(499, 1199), 'URBAN COMPANY', false, 'urbancompany@hdfcbank'));

      // Friends paying back / refunds
      if (rnd() < 0.08)
        push(21, (w) =>
          events.push({ at: w, kind: 'sms', sender: 'AX-KOTAKB-S', body: `Received Rs.${rs(between(300, 1500))} in your Kotak Bank AC X9911 from ${pick(['rohan.verma@okaxis', 'priya.nair@ybl', 'kabir.singh@okicici'])} on ${fmt(key).dash}.UPI Ref:${ref()}.` }),
        );
      if (day === 16) push(14, (w) => events.push({ at: w, kind: 'sms', sender: 'VK-ICICIB-S', body: `Dear Customer, INR 1,299.00 has been credited to your ICICI Bank Credit Card XX9876 on ${fmt(key).mon} as reversal of transaction at AMAZON PAY INDIA.` }));

      // Cash (manual entries)
      if (rnd() < 0.3) push(17, (w) => events.push({ at: w, kind: 'cash', cash: { amountPaise: between(20, 60) * 100, merchant: 'Chai tapri', categoryId: 'food' } }));
      if (rnd() < 0.15) push(10, (w) => events.push({ at: w, kind: 'cash', cash: { amountPaise: between(80, 180) * 100, merchant: 'Auto rickshaw', categoryId: 'transport' } }));
      if (rnd() < 0.1) push(18, (w) => events.push({ at: w, kind: 'cash', cash: { amountPaise: between(120, 400) * 100, merchant: 'Sabzi wala', categoryId: 'groceries', notes: 'Vegetables' } }));
    }

    // Noise + review items in the last few days.
    const recentKey = addDays(todayKey, -1);
    const noise: Array<[string, string, string]> = [
      ['VM-HDFCBK-S', '482913 is OTP for txn of INR 2,499.00 at MYNTRA on HDFC Bank card ending 5678. Valid till 14:45. Do not share OTP for security reasons', 'sms'],
      ['VM-HDFCBK-P', 'Dear Customer, enjoy 10% cashback up to Rs.1,000 on Swiggy with your HDFC Bank Credit Card. Offer valid till month end. T&C apply. hdfcbk.io/xyz', 'sms'],
      ['VK-ICICIB-S', `Statement for ICICI Bank Credit Card XX9876 has been generated. Total Amount Due: INR 16,940.00. Minimum Amount Due: INR 850.00. Payment Due Date: 05-${MON[t.month - 1]}-${String(t.year).slice(2)}. Ignore if already paid.`, 'sms'],
      ['VM-HDFCBK-S', 'HDFC Bank: Txn of INR 3,450.00 on A/c XX1234 ref 998877665544 is under process.', 'sms'],
      ['JD-IDFCFB-S', 'IDFC FIRST Bank: Your a/c XX7781 has been debited towards UPI mandate for YOUTUBE PREMIUM. Check app for details.', 'sms'],
    ];
    noise.forEach(([sender, body], i) => events.push({ at: at(recentKey, 9 + i), kind: 'sms', sender, body }));

    events.sort((a, b) => a.at.getTime() - b.at.getTime());

    // ── Ingest ──────────────────────────────────────────────────────────────
    const tally: Record<string, number> = {};
    for (const e of events) {
      if (e.at > now) continue;
      if (e.kind === 'cash') {
        await createTransaction(db, { ...e.cash!, direction: 'debit', occurredAt: e.at, channel: 'cash' });
        tally.cash = (tally.cash ?? 0) + 1;
        continue;
      }
      const out = await ingestMessage(db, {
        source: e.kind,
        via: 'seed',
        sender: e.sender,
        subject: e.subject,
        body: e.body!,
        receivedAt: new Date(e.at.getTime() + 5_000),
        externalId: e.kind === 'email' ? `<seed-${e.at.getTime()}-${tally.email ?? 0}@example.invalid>` : null,
      });
      tally[out.status] = (tally[out.status] ?? 0) + 1;
      if (e.kind === 'email') tally.email = (tally.email ?? 0) + 1;
    }
    console.log('✔ seeded', tally);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

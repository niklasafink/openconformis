/**
 * Bringt ein zweites Konto in den Arbeitsbereich eines ersten, damit das Vier-Augen-
 * Prinzip der Offenlegungspflicht (Prüfer übernimmt, Manager gibt frei) mit zwei echten
 * Personen durchgespielt werden kann. Eine Einladungs-Oberfläche gibt es bewusst noch
 * nicht (docs/OFFENLEGUNG_SESSION_PROMPT.md §12).
 *
 * Beide Konten müssen sich vorher mindestens einmal angemeldet haben. Die neue
 * Mitgliedschaft wird vor die bisherigen gestellt, weil die Anwendung den Arbeitsbereich
 * der ältesten Mitgliedschaft öffnet; der persönliche Arbeitsbereich des zweiten Kontos
 * bleibt bestehen und ist nach `--remove` wieder der aktive.
 *
 *   pnpm disclosure:add-member <e-mail-zweites-konto> <e-mail-erstes-konto> [--role admin]
 *   pnpm disclosure:add-member <e-mail-zweites-konto> <e-mail-erstes-konto> --remove
 *
 * Rollen: admin (Manager, Standard), analyst oder reviewer (nur Prüfer), viewer (lesend).
 * Die Datenbank kommt aus DATABASE_URL (über `.env.local` die Produktion).
 */

import { randomUUID } from "node:crypto";

import postgres from "postgres";

const roles = new Set(["admin", "analyst", "reviewer", "viewer"]);

const args = process.argv.slice(2);
const positional = args.filter(
  (arg, index) => !arg.startsWith("--") && args[index - 1] !== "--role",
);
const roleIndex = args.indexOf("--role");
const role = roleIndex >= 0 ? (args[roleIndex + 1] ?? "") : "admin";
const remove = args.includes("--remove");
const [memberEmail, ownerEmail] = positional.map((value) => value.trim().toLowerCase());

if (!memberEmail || !ownerEmail || !roles.has(role)) {
  console.error(
    "Aufruf: pnpm disclosure:add-member <e-mail-zweites-konto> <e-mail-erstes-konto> [--role admin|analyst|reviewer|viewer] [--remove]",
  );
  process.exit(1);
}
if (memberEmail === ownerEmail) {
  console.error("Das zweite Konto muss eine andere Person sein als das erste.");
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL fehlt. Mit `pnpm disclosure:add-member …` wird .env.local gelesen.");
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => undefined });

async function userByEmail(email: string) {
  const [user] = await sql<{ id: string; name: string | null }[]>`
    select id, name from users where lower(email) = ${email} limit 1`;
  return user;
}

try {
  const member = await userByEmail(memberEmail);
  const owner = await userByEmail(ownerEmail);
  if (!member || !owner) {
    console.error(
      `${!member ? memberEmail : ownerEmail} ist nicht bekannt. Bitte mit diesem Konto einmal anmelden.`,
    );
    process.exitCode = 1;
  } else {
    const [primary] = await sql<{ organization_id: string; name: string }[]>`
      select m.organization_id, o.name from members m join organizations o on o.id = m.organization_id
      where m.user_id = ${owner.id} order by m.created_at asc limit 1`;
    if (!primary) {
      console.error(`${ownerEmail} hat noch keinen Arbeitsbereich. Bitte einmal anmelden.`);
      process.exitCode = 1;
    } else if (remove) {
      const removed = await sql`
        delete from members where organization_id = ${primary.organization_id} and user_id = ${member.id}
        returning id`;
      console.log(
        removed.length > 0
          ? `${memberEmail} ist nicht mehr Mitglied von „${primary.name}“.`
          : `${memberEmail} war kein Mitglied von „${primary.name}“.`,
      );
    } else {
      await sql.begin(async (transaction) => {
        await transaction`select pg_advisory_xact_lock(hashtextextended(${member.id}, 0))`;
        // In SQL gerechnet: `created_at` hat keine Zeitzone, JavaScript würde sie verschieben.
        await transaction`
          insert into members (id, organization_id, user_id, role, created_at)
          select ${randomUUID()}, ${primary.organization_id}, ${member.id}, ${role},
            coalesce(min(created_at), localtimestamp) - interval '1 minute'
          from members
          where user_id = ${member.id} and organization_id <> ${primary.organization_id}
          on conflict (organization_id, user_id)
          do update set role = excluded.role, created_at = excluded.created_at`;
      });
      console.log(
        `${memberEmail} arbeitet jetzt als ${role} im Arbeitsbereich „${primary.name}“ von ${ownerEmail}. Einmal ab- und wieder anmelden.`,
      );
    }
  }
} finally {
  await sql.end({ timeout: 5 });
}

# Scraper Engine Documentation (Layer 3 - Engine)

This document explains how the scraper currently works, how to run it, and how to add or debug university-specific adapters.

The scraper is not the first step in the data pipeline. UCAS data is imported first, then the scraper fills in missing tuition fees from university websites or university fee sources.

## Pipeline Overview

The normal flow is:

```text
src/ucas_job.ts / src/ucas.ts
  -> imports UCAS data
  -> stores University, Course, and CourseOption rows in Prisma
  -> src/scrapers/manager.ts queries CourseOptions with missing fees
  -> groups options by university and course
  -> selects an adapter using src/scrapers/config.ts
  -> adapter scrapes fees and returns results per CourseOption
  -> manager updates the CourseOption rows
  -> logs are written to terminal and backend/logs/scrape-*.log
```

A `Course` is the shared course record. A `CourseOption` is the specific version of that course, for example full-time, part-time, different duration, or different qualification route.

This matters because the scraper does not just scrape one fee per course. It often needs to map fees back to the exact option row.

## Setup Commands

From the backend directory:

```bash
cd backend
npm install
npx prisma generate
```

To fully reset your local database and apply migrations:

```bash
cd backend
npx prisma migrate reset --force
```

Be careful with `migrate reset`. It deletes local database data and recreates the schema from migrations.

After resetting, import the UCAS data again:

```bash
cd backend
npx ts-node src/ucas_job.ts
```

Only run the scraper after the UCAS import has populated the database.

## Viewing The Database

Use Prisma Studio:

```bash
cd backend
npx prisma studio
```

University IDs are stored in the `University` table. The scraper CLI uses university IDs, not university names.

Useful tables to inspect:

- `University`: contains the university ID and name.
- `Course`: contains the course title, UCAS course ID, university ID, and course URL.
- `CourseOption`: contains study mode, year, duration, qualification, and fee fields.

## Running Scrapes

Run the scraper from the backend directory.

Scrape all missing-fee options for one university:

```bash
cd backend
npx ts-node src/scrapers/manager.ts --universityIds="UNIVERSITY_ID"
```

Scrape one course name for one university:

```bash
cd backend
npx ts-node src/scrapers/manager.ts --universityIds="UNIVERSITY_ID" --q="Course Name"
```

Scrape rows that already have a fee value, useful when you want to re-test or compare an already-filled course:

```bash
cd backend
npx ts-node src/scrapers/manager.ts --universityIds="UNIVERSITY_ID" --q="Course Name" --minFee=1
```

By default, if you do not pass `--minFee` or `--maxFee`, the manager only targets options where `homeFee` or `internationalFee` is missing.

The current supported CLI filters are:

```text
--q="text"
--universityIds="id1,id2"
--year=2026
--minFee=1
--maxFee=50000
--feeType=home
--feeType=international
--level=Full-time
--level=Part-time
```

`--q` searches course title, summary, and UCAS course ID.

`--feeType` only matters when using `--minFee` or `--maxFee`. If `feeType` is `international`, the filter applies to `internationalFee`. Otherwise it applies to `homeFee`.

## Reading Logs

Every scraper run writes to the terminal and to a file in:

```text
backend/logs/scrape-*.log
```

A successful option looks like this:

```text
> Option [option-id]: Home £9535, Intl £32950
```

That means the adapter found at least one fee and the manager updated that `CourseOption` row.

A failed option looks like this:

```text
> Option [option-id]: No fees found.
```

That means the adapter returned no usable home or international fee for that option.

A missing URL looks like this:

```text
Skipping Course Name course-id: No URL
```

That means the course has no `courseUrl` in the database and the selected adapter is not allowed to resolve missing URLs itself.

Some adapters can handle missing URLs because they have their own lookup logic. At the time of writing, the manager allows missing URL resolution for these adapters:

```text
NottsAdapter
QueenMaryAdapter
SheffieldAdapter
SouthamptonAdapter
StAndrewsAdapter
SunderlandAdapter
SoasAdapter
WarwickAdapter
```

## Adapter Contract

Adapters implement the `IScraperAdapter` interface from `src/scrapers/interfaces.ts`.

The current course scraping signature is:

```ts
scrapeCourse?(courseUrl: string, contexts: ScrapeContext[]): Promise<OptionScrapeResult[]>;
```

This is important. The adapter receives one course URL and a list of option contexts. It should return one result per option where possible.

The context passed into the adapter looks like this:

```ts
export interface ScrapeContext {
    optionId: string;
    courseTitle: string;
    studyMode: string | null;
    year: number;
    duration: string | null;
    outcomeQualification?: string | null;
}
```

What each field is for:

- `optionId`: the exact `CourseOption` row that must be updated.
- `courseTitle`: useful for matching against search APIs or fee tables.
- `studyMode`: used to distinguish full-time, part-time, sandwich, placement, and similar routes.
- `year`: usually the application or entry year, for example `2026`.
- `duration`: useful when fee tables have rows like `1 year`, `2 years`, or `part-time 2 years`.
- `outcomeQualification`: useful when one page has several awards, for example MSc, PGDip, and PGCert.

The result returned by an adapter looks like this:

```ts
export interface OptionScrapeResult {
    optionId: string;
    homeFee: number | null;
    internationalFee: number | null;
    scotlandFee?: number | null;
}
```

The manager uses `optionId` to update the correct database row.

## Core Components

### Manager

File:

```text
src/scrapers/manager.ts
```

The manager is responsible for:

- Parsing CLI filters.
- Querying `CourseOption` rows from Prisma.
- Grouping options by university and course.
- Finding the correct scraper config for each university.
- Creating the correct adapter.
- Calling `adapter.scrapeCourse(courseUrl, contexts)`.
- Updating `CourseOption.homeFee` and `CourseOption.internationalFee`.
- Writing logs and summary stats.

### Config

File:

```text
src/scrapers/config.ts
```

This maps university names to scraping strategies and adapters.

Example:

```ts
"University of Oxford": {
    strategy: "CUSTOM_HTML",
    adapterName: "OxfordAdapter"
}
```

The manager first tries an exact university name match. If that fails, it does a simple fuzzy name match where either name contains the other.

### Generic HTML Adapter

File:

```text
src/scrapers/adapters/GenericHtml.ts
```

This is the default parser for standard HTML pages. It does the shared work used by most custom adapters:

- Fetches HTML with Axios.
- Detects PDFs and parses them with `pdf-parse`.
- Falls back to Puppeteer when Axios returns an empty shell or dynamic page.
- Parses tables, div grids, label-value pairs, and text patterns.
- Selects likely home, international, and Scotland fee values.
- Sanitizes content based on study mode to reduce wrong full-time or part-time matches.

Custom adapters usually extend `GenericHtmlAdapter` and only add the logic needed for that university.

## Strategy Types

The current strategy values are:

```ts
GENERIC_HTML
CUSTOM_HTML
BULK_PDF
HYBRID
```

Use them like this:

- `GENERIC_HTML`: standard HTML parsing with `GenericHtmlAdapter`.
- `CUSTOM_HTML`: a university-specific adapter handles special parsing or URL logic.
- `BULK_PDF`: a central PDF source is used instead of per-course pages.
- `HYBRID`: a central source is used, but per-course scraping may still run.

## Adding A New University Adapter

1. Create a new adapter file:

```text
src/scrapers/adapters/NewUni.ts
```

2. Import it in `src/scrapers/manager.ts`:

```ts
import { NewUniAdapter } from './adapters/NewUni';
```

3. Add it to `getAdapter()` in `manager.ts`:

```ts
case 'NewUniAdapter': return new NewUniAdapter();
```

4. Add a config entry in `src/scrapers/config.ts`:

```ts
"University Name From DB": {
    strategy: "CUSTOM_HTML",
    adapterName: "NewUniAdapter"
}
```

5. Test with one course first:

```bash
cd backend
npx ts-node src/scrapers/manager.ts --universityIds="UNIVERSITY_ID" --q="Course Name"
```

6. If that works, test the full university:

```bash
cd backend
npx ts-node src/scrapers/manager.ts --universityIds="UNIVERSITY_ID"
```

## Common Adapter Patterns

Most custom adapters do one or more of these things before calling the generic parser:

- Remove misleading page sections before parsing.
- Resolve stale UCAS URLs to current university URLs.
- Query a university search endpoint to find the real course page.
- Parse central fee tables instead of individual course pages.
- Match fees by `studyMode`, `duration`, or `outcomeQualification`.
- Parse PDFs or central fee documents.
- Return different fees for different `CourseOption` rows on the same course.

## Deep Dive: Edinburgh Adapter

The University of Edinburgh's website poses a unique challenge:

1. It can load some course content dynamically.
2. The main course page link can point to a general overview.
3. Specific fee data may need a better course-specific URL before generic parsing works.

The `EdinburghAdapter` extends `GenericHtmlAdapter` and adds a preprocessing step before delegating to the shared parser.

Simplified flow:

```ts
export class EdinburghAdapter extends GenericHtmlAdapter {
    override async scrapeCourse(url: string, contexts: ScrapeContext[]): Promise<OptionScrapeResult[]> {
        const betterUrl = await this.resolveBetterUrl(url, contexts);
        return super.scrapeCourse(betterUrl, contexts);
    }
}
```

The key idea is that a custom adapter should only own the university-specific weirdness. Once it has the right URL or cleaned HTML, it should reuse the generic parser where possible.

## When Something Fails

When a university fails, start from the log file for that run. The log tells you the selected adapter, the course URL being used, and whether the adapter found fees for each option.

The usual first question is whether the scraper is looking at the right page. If UCAS gave us a stale or generic URL, a custom adapter may need to resolve the current course page before parsing fees. If the URL is correct, inspect how the fees are shown on the page. Some universities use plain tables, some use expandable sections, some use central fee pages, and some use PDFs.

After that, check whether the failure is really a course-level problem or an option-level problem. A page can contain the right fees, but the adapter may still need to choose the right row for full-time, part-time, duration, or qualification. This is why `ScrapeContext` includes fields like `studyMode`, `duration`, and `outcomeQualification`.

If a university is not listed in `config.ts`, it falls back to `GenericHtmlAdapter`.

---

Last updated: April 2026

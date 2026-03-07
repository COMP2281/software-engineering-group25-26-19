# Scraper Engine Documentation (Layer 3 - Engine)

This document provides a detailed breakdown of the Scraper Engine, focusing on the Adapter pattern, execution flow, and extensibility.

## 🏗 Architecture

The scraper is designed with modularity in mind, allowing different universities to be scraped using tailored logic while sharing a common execution pipeline.

### Core Components

1.  **Manager (`src/scrapers/manager.ts`)**: The orchestrator.
    - Loads configuration from `src/scrapers/config.ts`.
    - Selects the appropriate adapter based on the university config.
    - Runs the scraping loop (rate-limited).
    - Persists results to the database via Prisma.

2.  **Generic Adapter (`src/scrapers/adapters/GenericHtml.ts`)**:
    - Default behavior for standard HTML pages.
    - Features:
        - **Cheerio**: Fast static HTML parsing.
        - **Puppeteer Fallback**: Automatically launches a headless browser if static parsing fails or if dynamic content is detected.
        - **Fee Extraction Heuristics**: Regex-based pattern matching for "£9,250", "International", "Home", etc.

3.  **Specific Adapters (`src/scrapers/adapters/*.ts`)**:
    - Extend `GenericHtmlAdapter` or implement `IScraperAdapter` directly.
    - Handle edge cases like:
        - PDF-only prospectuses (`BulkPdfAdapter`).
        - Single Page Applications (SPAs) requiring JavaScript execution (`EdinburghAdapter`).
        - Complex fee table structures (`GlasgowAdapter`).

## 🔌 The Adapter Pattern

All adapters must implement the `IScraperAdapter` interface:

```typescript
export interface IScraperAdapter {
    scrapeCourse(url: string): Promise<ScrapedFees>;
}
```

This ensures the Manager can invoke `scrapeCourse()` uniformly regardless of the underlying implementation.

## 🧪 Deep Dive: Edinburgh Adapter

The University of Edinburgh's website poses a unique challenge:
1.  **SPA Architecture**: Pages load content dynamically.
2.  **Hidden Fee Data**: The main course page link often redirects to a general overview; the specific fee data is sometimes hidden behind an internal "programme_code" link or AJAX call.

### Implementation (`src/scrapers/adapters/Edinburgh.ts`)

The `EdinburghAdapter` extends `GenericHtmlAdapter` to add a preprocessing step:

1.  **Interception**: It checks if the URL is a postgraduate course.
2.  **Link Discovery**: It fetches the initial HTML using `axios` (fast).
3.  **Extraction**: It parses the DOM to find a link containing `programme_code=`.
4.  **Redirection**: If found, it updates the target URL to the direct fee page.
5.  **Delegation**: Finally, it calls `super.scrapeCourse(targetUrl)`, letting the robust Generic logic (with Puppeteer support) handle the actual fee extraction.

```typescript
// Simplified logic
export class EdinburghAdapter extends GenericHtmlAdapter {
    override async scrapeCourse(url: string): Promise<ScrapedFees> {
        // ... (preprocessing to find better URL) ...
        return super.scrapeCourse(betterUrl);
    }
}
```

## 🛠 Maintainability & Troubleshooting

Web scraping is inherently fragile. UI changes on university websites will break scrapers.

### Common Issues & Fixes

1.  **Changed Selectors**: If a university redesigns their site, the CSS selectors in `GenericHtmlAdapter` (or specific adapters) may fail.
    - **Fix**: Update the jQuery-style selectors in `cheerio.load()` calls.
    - **Tip**: Use Chrome DevTools `Inspect Element` -> `Copy Selector` to find the new path.

2.  **Anti-Bot Measures**: 
    - **Symptoms**: 403 Forbidden errors, CAPTCHAs.
    - **Fix**: 
        - Increase `delay` in `src/scrapers/config.ts`.
        - Rotate User-Agent headers.
        - Use Puppeteer with `puppeteer-extra-plugin-stealth` (if installed).

3.  **PDF Parsing Failures**:
    - `pdf-parse` library may struggle with complex layouts.
    - **Fix**: Manually verify the PDF structure. Consider upgrading to a OCR-based solution if text extraction is consistently garbled.

### Adding a New University

1.  **Analyze the Target**: Check if fees are in HTML or specific PDFs.
2.  **Choose Strategy**:
    - If standard HTML: Use `GenericHtmlAdapter`.
    - If special logic needed: Create `src/scrapers/adapters/NewUni.ts`.
3.  **Register Adapter**:
    - Add to `getAdapter` switch case in `src/scrapers/manager.ts`.
    - Update `src/scrapers/config.ts` with the new university entry.

## 📊 Testing Scrapers

You can test a specific adapter in isolation using the CLI arguments:

```bash
# Test specific university logic
npm run start:scraper -- --uni="University of Edinburgh"

# Test a single course URL
npm run start:scraper -- --course="https://www.ed.ac.uk/studying/..."
```

---
*Last Updated: March 2026*

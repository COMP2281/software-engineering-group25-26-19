import * as cheerio from 'cheerio';
import { GenericHtmlAdapter } from './GenericHtml';
import { ScrapeContext, ScrapedFees } from '../interfaces';

export class UCLAdapter extends GenericHtmlAdapter {
    protected override sanitizeForStudyMode(html: string, _studyMode: string): string {
        // UCL presents full/part fees in shared blocks; stripping by mode drops valid values.
        return html;
    }

    protected override async parseHtml(html: string, context: ScrapeContext, isPdf: boolean): Promise<ScrapedFees> {
        if (isPdf) {
            return super.parseHtml(html, context, isPdf);
        }

        const $ = cheerio.load(html);
        const tableFees = this.extractFromFeeTable($, context.studyMode || '');
        const keyInfoFees = this.extractFromKeyInfo($, context.studyMode || '');
        const genericFees = await super.parseHtml(html, context, false);

        const result: ScrapedFees = {
            homeFee: tableFees.homeFee ?? keyInfoFees.homeFee ?? genericFees.homeFee,
            internationalFee: tableFees.internationalFee ?? keyInfoFees.internationalFee ?? genericFees.internationalFee
        };

        if (genericFees.scotlandFee !== undefined) {
            result.scotlandFee = genericFees.scotlandFee;
        }

        return result;
    }

    private extractFromFeeTable($: cheerio.CheerioAPI, studyMode: string): ScrapedFees {
        const table = $('section.prog-fees table.uk-overseas-toggle').first().length
            ? $('section.prog-fees table.uk-overseas-toggle').first()
            : $('table.uk-overseas-toggle').first();

        if (!table.length) {
            return { homeFee: null, internationalFee: null };
        }

        const rows = table.find('tr');
        if (rows.length < 2) {
            return { homeFee: null, internationalFee: null };
        }

        const headerCells = rows
            .first()
            .find('th,td')
            .map((_, cell) => this.normalizeText($(cell).text()))
            .get();

        const modeColumn = this.pickModeColumnIndex(headerCells, studyMode);
        let homeFee: number | null = null;
        let internationalFee: number | null = null;

        rows.slice(1).each((_idx, row) => {
            const $row = $(row);
            const rowClass = this.normalizeText($row.attr('class') || '');
            const cells = $row
                .find('th,td')
                .map((__, cell) => $(cell).text().replace(/\s+/g, ' ').trim())
                .get();

            if (cells.length < 2) return;

            const rowText = this.normalizeText(cells.join(' '));
            const isInternational = rowClass.includes('international') || /(?:international|overseas)/.test(rowText);
            const isHome = rowClass.includes(' uk') || rowClass.endsWith('uk') || /\buk tuition fees\b/.test(rowText);
            if (!isInternational && !isHome) return;

            const selectedCellText = this.pickCellByMode(cells, modeColumn);
            const fee = this.extractAmount(selectedCellText);
            if (fee === null) return;

            if (isInternational) internationalFee = fee;
            if (isHome) homeFee = fee;
        });

        return { homeFee, internationalFee };
    }

    private extractFromKeyInfo($: cheerio.CheerioAPI, studyMode: string): ScrapedFees {
        const ukText = $('.prog-key-info .uk-overseas.uk').first().text().replace(/\s+/g, ' ').trim();
        const intlText = $('.prog-key-info .uk-overseas.international').first().text().replace(/\s+/g, ' ').trim();

        const ukValues = this.extractAllAmounts(ukText);
        const intlValues = this.extractAllAmounts(intlText);

        return {
            homeFee: this.selectAmountByMode(ukValues, studyMode),
            internationalFee: this.selectAmountByMode(intlValues, studyMode)
        };
    }

    private pickModeColumnIndex(headerCells: string[], studyMode: string): number {
        if (headerCells.length <= 1) return 1;

        const mode = this.normalizeText(studyMode);
        if (mode.includes('part')) {
            const idx = headerCells.findIndex(h => h.includes('part-time') || h === 'part time');
            if (idx >= 1) return idx;
        }
        if (mode.includes('full')) {
            const idx = headerCells.findIndex(h => h.includes('full-time') || h === 'full time');
            if (idx >= 1) return idx;
        }
        if (mode.includes('flex') || mode.includes('modular')) {
            const idx = headerCells.findIndex(h => h.includes('flex') || h.includes('modular'));
            if (idx >= 1) return idx;
        }

        // Default to first fee column (usually full-time).
        return 1;
    }

    private pickCellByMode(cells: string[], modeColumn: number): string {
        if (modeColumn < cells.length && cells[modeColumn]) {
            return cells[modeColumn] || '';
        }
        // Fallback to first fee value column if chosen mode column is absent.
        return cells[1] || '';
    }

    private selectAmountByMode(values: number[], studyMode: string): number | null {
        if (values.length === 0) return null;
        if (values.length === 1) return values[0] || null;

        const mode = this.normalizeText(studyMode);
        if (mode.includes('part') || mode.includes('flex') || mode.includes('modular')) {
            return Math.min(...values);
        }
        if (mode.includes('full')) {
            return Math.max(...values);
        }

        // Unknown mode: prefer full-time-sized value.
        return Math.max(...values);
    }

    private extractAllAmounts(text: string): number[] {
        const values: number[] = [];
        const regex = /£\s*([0-9]{1,3}(?:,[0-9]{3})*)/g;
        let match: RegExpExecArray | null = null;
        while ((match = regex.exec(text)) !== null) {
            const parsed = this.extractAmount(match[0]);
            if (parsed !== null) values.push(parsed);
        }
        return values;
    }

    private extractAmount(text: string | undefined): number | null {
        if (!text) return null;
        const match = String(text).match(/£\s*([0-9]{1,3}(?:,[0-9]{3})*)/);
        if (!match?.[1]) return null;
        const parsed = parseInt(match[1].replace(/,/g, ''), 10);
        if (Number.isNaN(parsed) || parsed < 1000 || parsed > 120000) return null;
        return parsed;
    }

    private normalizeText(value: string): string {
        return value.toLowerCase().replace(/\s+/g, ' ').trim();
    }
}

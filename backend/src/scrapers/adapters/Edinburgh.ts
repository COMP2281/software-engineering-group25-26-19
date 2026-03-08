// src/scrapers/adapters/Edinburgh.ts

import axios from 'axios';
import * as cheerio from 'cheerio';
import { GenericHtmlAdapter } from './GenericHtml';
import { OptionScrapeResult, ScrapeContext } from '../interfaces';

const DEBUG = true;

const HEADERS_BROWSER = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
};

export class EdinburghAdapter extends GenericHtmlAdapter {
    
    override async scrapeCourse(courseUrl: string, contexts: ScrapeContext[]): Promise<OptionScrapeResult[]> {
        let targetUrl = courseUrl;

        // Check if it's a postgraduate course
        if (targetUrl.includes('postgraduate-taught') || targetUrl.includes('postgraduate-research')) {
            if (DEBUG) console.log(`[DEBUG] Edinburgh: Intercepting PG course to find internal programme_code...`);
            
            try {
                const response = await axios.get(courseUrl, { headers: HEADERS_BROWSER, timeout: 10000 });
                const $ = cheerio.load(response.data);
                
                let foundFeeUrl: string | null = null;

                $('a').each((_, el) => {
                    const href = $(el).attr('href');
                    if (href && href.includes('programme_code=')) {
                        foundFeeUrl = new URL(href, courseUrl).toString();
                        return false; 
                    }
                    return true;
                });

                if (foundFeeUrl) {
                    if (DEBUG) console.log(`[DEBUG] Edinburgh: Fast-forwarding directly to fee page -> ${foundFeeUrl}`);
                    targetUrl = foundFeeUrl;
                }
            } catch (error) {
                if (DEBUG) console.log(`[DEBUG] Edinburgh: Failed to intercept main page. ${error}`);
            }
        }

        // Pass the resolved targetUrl and the contexts to the GenericHtmlAdapter
        // It will now handle the context looping and study-mode sanitization automatically.
        return super.scrapeCourse(targetUrl, contexts);
    }
}
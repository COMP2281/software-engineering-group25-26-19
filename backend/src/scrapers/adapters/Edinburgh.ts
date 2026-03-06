// src/scrapers/adapters/Edinburgh.ts

import axios from 'axios';
import * as cheerio from 'cheerio';
import { GenericHtmlAdapter } from './GenericHtml';
import { ScrapedFees } from '../interfaces';

const DEBUG = true;

const HEADERS_BROWSER = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
};

/**
 * EdinburghAdapter extends the GenericHtmlAdapter.
 * It intercepts course URLs, does a lightning-fast fetch to find the internal 
 * 'programme_code' fee link, and fast-forwards the scraper to that page.
 */
export class EdinburghAdapter extends GenericHtmlAdapter {
    
    override async scrapeCourse(courseUrl: string, courseTitle?: string): Promise<ScrapedFees> {
        let targetUrl = courseUrl;

        // Check if it's a postgraduate course (taught or research)
        if (targetUrl.includes('postgraduate-taught') || targetUrl.includes('postgraduate-research')) {
            if (DEBUG) console.log(`[DEBUG] Edinburgh: Intercepting PG course to find internal programme_code...`);
            
            try {
                // Fast Axios fetch of the main page
                const response = await axios.get(courseUrl, { headers: HEADERS_BROWSER, timeout: 10000 });
                const $ = cheerio.load(response.data);
                
                let foundFeeUrl: string | null = null;

                // Look for the specific link containing the programme_code
                $('a').each((_, el) => {
                    const href = $(el).attr('href');
                    if (href && href.includes('programme_code=')) {
                        // Resolve relative URLs to absolute URLs safely
                        foundFeeUrl = new URL(href, courseUrl).toString();
                        return false; // Break the loop
                    }
                    return true;
                });

                if (foundFeeUrl) {
                    if (DEBUG) console.log(`[DEBUG] Edinburgh: Fast-forwarding directly to fee page -> ${foundFeeUrl}`);
                    targetUrl = foundFeeUrl;
                } else {
                    if (DEBUG) console.log(`[DEBUG] Edinburgh: Could not find programme_code link. Proceeding normally.`);
                }
            } catch (error) {
                if (DEBUG) console.log(`[DEBUG] Edinburgh: Failed to intercept main page. ${error}`);
            }
        }

        // Pass the resolved targetUrl to the powerful GenericHtmlAdapter logic.
        // Because Edinburgh's fee page is an SPA, the Generic adapter will try Axios, 
        // see it's empty, and automatically trigger Puppeteer to render the table.
        return super.scrapeCourse(targetUrl, courseTitle);
    }
}
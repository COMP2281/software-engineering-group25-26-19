## Quick Markdown file of universities that fail on our tests:

List of unis with ANY sort of error. Most are minor and I've included roughly how much of the fees are already in the DB (from UCAS).

- [x] University of Aberdeen: Most should work with PDF parsing, or are filled by UCAS, script only ran on online courses which need different parsing logic (keyword differences). Most fees present in DB.

- [x] University of Bath: Nuanced course options are not directly linked by the url provided by UCAS. Although they can be found from the UCAS URL most of them do not have tuition fees anyways. Further testing needed, no fees present. Needs custom adapter. Custom adapter mostly complete, needs further testing.

- [X] University of Birmingham: Intl fees not properly located due to unique structure (dropdown menu for each country, although all Intl fees are the same). Most fees not present. Custom adapter implemented for dropdown menu, puppeteer gets blocked SOMETIMES.

- [X] University of Bristol: No fees found, probably due to html structure we've not accounted for. Most fees present in DB.

- [X] University of Cambridge: Postgraduate course fees are located on a subpage, that the scraper does not find due to locating an incorrect subpage (tuition fees overview page). Undergrad fees should work with PDF parser. Some fees present

- [X] University of Edinburgh: Should work for pretty much everything, but SOME courses have their tuition fees listed on a sub-sub-page. Most fees not present in DB (but should be after scraper runs).

- [X] University of Exeter: Sometimes finds the wrong fees, should be fixed by improving semantics parsing. Overall works fine we need better differentiation between full time, part time, and international/home fees anyways. Half of fees present in DB. Doesn't work for apprenticeships/weird degrees/programs

- [X] University of Glasgow: Will need separate logic, course fees are listed on a separate webpage and distinguished by type of course rather than specific course. No fees present in DB. Adapter needs further testing, MAY be mapping courses to the wrong fee bands.

- [X] University of Lancaster: Does not find fees on course page, likely unique HTML structure again or missing keyword(s). No fees in DB.

- [X] University of Liverpool: Needs further testing, combined courses failed (to be expected as the UCAS url links to the selection page and I don't think we need to cover combined courses anyways). No fees in DB.

- [X] Loughborough Uni: Does not find fees on course page, likely unique HTML/keywords again. Undergrad foundation years correctly process however intl fees are not listed (not manually located yet). Some fees present in DB.

- [X] Manchester Uni: Fees stated as pure text on course page, AI should be able to fix this quickly. No fees present in DB.

- [X] Newcastle Uni: Course page fees once again not found, may have unique keywords/html structure again. Some home fees simply unavailable. No fees in DB. This uni still hasn't released their home fees for a lot of courses, but I'm not fixing for that it'll work when they release the fees (probably just 9790)

- [ ] Northumbria Uni: UCAS sometimes gives invalid URLs (i.e: accounting extended degree UCAS url is literally the homepage of northumbria uni). Otherwise works fine. No fees in DB. Low priority, only breaks when UCAS gives an invalid URL.

- [ ] University of Nottingham: Doesn't work for foundation courses

- [X] University of Oxford: Doesn't work for all graduate courses as you must click on a button to end up landing on the required page. Foundation Years should be free of charge (oxford only!), and must manage redirects to actual course page!

- [X] Queen Mary University of London: completely incorrect scrapes, both home and intl fees are either null or misfigured completely, requires spearate script that is highly specialised to fix this issue!

- [ ] Queen's University Belfast: different tuition fees classifications based on NI, ROI, GB so must double check that scottish fees are quoted correctly, mostly PG courses that are problematic

- [X] University of Sheffield: stale URLs stored on UCAS server, foundation and masters courses fail completely with most UG courses failing too! Requires a highly specialised script to fix!

- [X] University of Southampton: stale URLs stored on UCAS server, foundation and masters courses fail completely with most UG courses failing too! Requires a highly specialised script to fix, swapped home and intl fees in a lot of instances too!

- [X] University of St Andrews: stale URLs stored on UCAS server, incorrect mapping of tuition fees to courseOptions, highly specialised script required!

- [X] University of Sunderland: no distinction between international and home fees, stale data, insufferable web-design making scrapers far too brittle!

- [X] UCL (University College London) : tough web-design navigation making scraping logic confused most of the time, a lot of courses that need a specific, highly curated script to fix them!

- [ ] University of Surrey: UG tuition fees are labelled "to be confirmed" on their website, PG courses have got their tuition fees collected.

- [X] SOAS University of London: strict limits when it comes to scraping, axios will be blocked quite frequently, international fees arent distinguished from home fees

- [X] University of Warwick: no clear fee structure, must look at internal tables for overseas fees, UG home is standard ofcourse across all. Table lookup needed for all PG courses

- [X] University of York: just requires duration-aware table matching, but UCAS API fetches most results anyways
## Quick Markdown file of universities that fail on our tests:

List of unis with ANY sort of error. Most are minor and I've included roughly how much of the fees are already in the DB (from UCAS).

- [x] University of Aberdeen: Most should work with PDF parsing, or are filled by UCAS, script only ran on online courses which need different parsing logic (keyword differences). Most fees present in DB.

- [x] University of Bath: Nuanced course options are not directly linked by the url provided by UCAS. Although they can be found from the UCAS URL most of them do not have tuition fees anyways. Further testing needed, no fees present. Needs custom adapter. Custom adapter mostly complete, needs further testing.

- [X] University of Birmingham: Intl fees not properly located due to unique structure (dropdown menu for each country, although all Intl fees are the same). Most fees not present. Custom adapter implemented for dropdown menu, puppeteer gets blocked SOMETIMES.

- [ ] University of Bristol: No fees found, probably due to html structure we've not accounted for. Most fees present in DB.

- [ ] University of Cambridge: Postgraduate course fees are located on a subpage, that the scraper does not find due to locating an incorrect subpage (tuition fees overview page). Undergrad fees should work with PDF parser. Some fees present

- [ ] University of Edinburgh: Should work for pretty much everything, but SOME courses have their tuition fees listed on a sub-sub-page. Most fees not present in DB (but should be after scraper runs).

- [ ] University of Exeter: Sometimes finds the wrong fees, should be fixed by improving semantics parsing. Overall works fine we need better differentiation between full time, part time, and international/home fees anyways. Half of fees present in DB.

- [ ] University of Glasgow: Will need separate logic, course fees are listed on a separate webpage and distinguished by type of course rather than specific course. No fees present in DB.

- [ ] University of Lancaster: Does not find fees on course page, likely unique HTML structure again or missing keyword(s). No fees in DB.

- [ ] University of Liverpool: Needs further testing, combined courses failed (to be expected as the UCAS url links to the selection page and I don't think we need to cover combined courses anyways). No fees in DB.

- [ ] Loughborough Uni: Does not find fees on course page, likely unique HTML/keywords again. Undergrad foundation years correctly process however intl fees are not listed (not manually located yet). Some fees present in DB.

- [ ] Manchester Uni: Fees stated as pure text on course page, AI should be able to fix this quickly. No fees present in DB.

- [ ] Newcastle Uni: Course page fees once again not found, may have unique keywords/html structure again. Some home fees simply unavailable. No fees in DB.

- [ ] Northumbria Uni: UCAS sometimes gives invalid URLs (i.e: accounting extended degree UCAS url is literally the homepage of northumbria uni). Otherwise works fine. No fees in DB.

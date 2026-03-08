import { fetchAllUcasCourses } from "./ucas";

fetchAllUcasCourses([
    "University of Aberdeen",
    "University of Bath",
    "University of Birmingham",
    "University of Bristol",
    "University of Cambridge",
    "Cardiff University",
    "Durham University",
    "The University of Edinburgh",
    "University of Exeter",
    "University of Glasgow",
    "Imperial College London",
    "King's College London, University of London (KCL)",
    "Lancaster University",
    "University of Leeds",
    "University of Liverpool",
    "Loughborough University",
])
    .then(() =>
        fetchAllUcasCourses([
            "London School of Economics and Political Science, University of London (LSE)",
            "University of Manchester",
            "Newcastle University",
            "Northumbria University, Newcastle",
            "University of Nottingham",
            "University of Oxford",
            "Queen Mary University of London",
            "Queen's University Belfast",
            "Royal Holloway, University of London",
            "University of Sheffield",
            "SOAS University of London",
            "University of Southampton",
            "University of St Andrews",
            "University of Sunderland",
            "University of Surrey",
            "University of Sussex",
            "UCL (University College London)",
            "University of Warwick",
            "University of York",
        ])
            .then(() => process.exit(0))
            .catch((e) => {
                console.error(e);
                process.exit(1);
            }),
    )
    .catch((e) => {
        console.error(e);
        process.exit(1);
    });

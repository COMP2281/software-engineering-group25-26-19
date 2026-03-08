import React, { useState } from "react";
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
  Legend,
} from "recharts";
import "./Visualisation.css";

const purple = "#68246d";

export default function VisualisationPage() {
  const [showCourseDropdown, setShowCourseDropdown] = useState(false);
  const [selectedCourse, setSelectedCourse] = useState("Computer Science");

  const courses = [
    "Computer Science",
    "Mechanical Engineering",
    "Business Management",
    "Law",
    "Medicine",
  ];

  const coursesPerUniversity = [
    { name: "Durham", courses: 120 },
    { name: "Manchester", courses: 110 },
    { name: "Leeds", courses: 95 },
    { name: "York", courses: 70 },
  ];

  const levelDistribution = [
    { name: "Undergraduate", value: 320 },
    { name: "Postgraduate", value: 180 },
  ];

  const studyModes = [
    { name: "Full-time", value: 410 },
    { name: "Part-time", value: 60 },
    { name: "Distance", value: 30 },
  ];

  const priceHistoryByCourse: Record<string, any[]> = {
    "Computer Science": [
      { year: "2021", home: 9000, international: 18000 },
      { year: "2022", home: 9250, international: 18500 },
      { year: "2023", home: 9250, international: 19000 },
      { year: "2024", home: 9250, international: 19500 },
    ],
    "Mechanical Engineering": [
      { year: "2021", home: 8800, international: 17500 },
      { year: "2022", home: 9100, international: 18200 },
      { year: "2023", home: 9200, international: 18800 },
      { year: "2024", home: 9250, international: 19200 },
    ],
    "Business Management": [
      { year: "2021", home: 8700, international: 17000 },
      { year: "2022", home: 9000, international: 17500 },
      { year: "2023", home: 9200, international: 18000 },
      { year: "2024", home: 9250, international: 18500 },
    ],
    Law: [
      { year: "2021", home: 8900, international: 17600 },
      { year: "2022", home: 9100, international: 18000 },
      { year: "2023", home: 9250, international: 18500 },
      { year: "2024", home: 9250, international: 18800 },
    ],
    Medicine: [
      { year: "2021", home: 9500, international: 30000 },
      { year: "2022", home: 9800, international: 31000 },
      { year: "2023", home: 10000, international: 32000 },
      { year: "2024", home: 10200, international: 33000 },
    ],
  };

  const priceHistory = priceHistoryByCourse[selectedCourse];

  const donutColors = ["#68246d", "#a36aa6", "#caa7cc"];

  return (
    <main className="mainContent">
      <div className="pageHeader">
        <div>
          <h1 className="pageTitle">Course Analytics</h1>
          <p className="pageSubTitle">
            Visual insights into courses and pricing trends
          </p>
        </div>
      </div>

      <section className="analyticsGrid">
        {/* Courses per University */}
        <div className="chartCard">
          <h3>Courses per University</h3>

          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={coursesPerUniversity}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="courses" fill={purple} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Level Distribution */}
        <div className="chartCard">
          <h3>Course Level Distribution</h3>

          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={levelDistribution}
                dataKey="value"
                nameKey="name"
                innerRadius={60}
                outerRadius={100}
                paddingAngle={3}
              >
                {levelDistribution.map((entry, index) => (
                  <Cell key={index} fill={donutColors[index]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Price Over Time */}
        <div className="chartCard">
          <div className="chartHeader">
            <h3>Course Price Over Time</h3>

            <div className="dropdown">
              <button
                className="dropdownToggle"
                onClick={() => setShowCourseDropdown((prev) => !prev)}
              >
                {selectedCourse}
                <i className="bi bi-chevron-down" />
              </button>

              {showCourseDropdown && (
                <div className="dropdownPanel">
                  {courses.map((course) => (
                    <div
                      key={course}
                      className="dropdownItem"
                      onClick={() => {
                        setSelectedCourse(course);
                        setShowCourseDropdown(false);
                      }}
                    >
                      {course}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={priceHistory}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="year" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line
                type="monotone"
                dataKey="home"
                stroke="#68246d"
                strokeWidth={3}
              />
              <Line
                type="monotone"
                dataKey="international"
                stroke="#c9a3cc"
                strokeWidth={3}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Study Mode Distribution */}
        <div className="chartCard">
          <h3>Study Mode Distribution</h3>

          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={studyModes}
                dataKey="value"
                nameKey="name"
                innerRadius={60}
                outerRadius={100}
                paddingAngle={3}
              >
                {studyModes.map((entry, index) => (
                  <Cell key={index} fill={donutColors[index]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend
               
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </section>
    </main>
  );
}

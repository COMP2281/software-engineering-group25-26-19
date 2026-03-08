import { useState, useEffect } from "react";
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
import {
  getUniversityDistribution,
  getLevelDistribution,
  getStudyModes,
  getSubjects,
  getPriceHistory,
} from "../api/Visualisation.api";
import type {
  UniversityDistributionItem,
  LevelDistributionItem,
  StudyModeItem,
  PriceHistoryItem,
} from "../api/Visualisation.types";

const purple = "#68246d";

export default function VisualisationPage() {
  const [showCourseDropdown, setShowCourseDropdown] = useState(false);
  const [selectedCourse, setSelectedCourse] = useState("Computer Science");

  const [coursesPerUniversity, setCoursesPerUniversity] = useState<UniversityDistributionItem[]>([]);
  const [levelDistribution, setLevelDistribution] = useState<LevelDistributionItem[]>([]);
  const [studyModes, setStudyModes] = useState<StudyModeItem[]>([]);
  const [priceHistory, setPriceHistory] = useState<PriceHistoryItem[]>([]);
  const [availableSubjects, setAvailableSubjects] = useState<string[]>([]);

  useEffect(() => {
    const fetchBaseData = async () => {
      try {
        const [uniData, levelData, studyData, subjectsData] = await Promise.all([
          getUniversityDistribution(),
          getLevelDistribution(),
          getStudyModes(),
          getSubjects(),
        ]);

        setCoursesPerUniversity(uniData);
        setLevelDistribution(levelData);
        setStudyModes(studyData);
        setAvailableSubjects(subjectsData);
        
        if (subjectsData.length > 0 && !subjectsData.includes(selectedCourse)) {
            setSelectedCourse(subjectsData[0]);
        }
      } catch (error) {
        console.error("Failed to fetch visualisation data:", error);
      }
    };

    fetchBaseData();
  }, []);

  useEffect(() => {
    const fetchPricing = async () => {
      if (!selectedCourse) return;
      try {
        const history = await getPriceHistory(selectedCourse);
        setPriceHistory(history);
      } catch (error) {
        console.error("Failed to fetch price history:", error);
      }
    };

    fetchPricing();
  }, [selectedCourse]);

  const donutColors = ["#68246d", "#a36aa6", "#caa7cc"];
  const studyModeColors = [
    "#68246d", // Dark Purple
    "#8e44ad", // Deep Violet
    "#a36aa6", // Medium Purple
    "#d2b4de", // Light Lavender
    "#9b59b6", // Amethyst
    "#512e5f", // Very Dark Purple
    "#e8daef", // Pale Purple
    "#76448a", // Grape
  ];

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
        {/* Courses per University - Full Width */}
        <div className="chartCard fullWidth">
          <h3>Courses per University</h3>
          
          <div style={{ width: '100%', overflowX: 'auto', overflowY: 'hidden' }}>
            <div style={{ width: Math.max(coursesPerUniversity.length * 60, 600), height: 300 }}>
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={coursesPerUniversity} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis 
                        dataKey="name" 
                        angle={-45} 
                        textAnchor="end" 
                        interval={0} 
                        height={80}
                        tick={{ fontSize: 12 }}
                    />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="courses" fill={purple} radius={[4, 4, 0, 0]} />
                    </BarChart>
                </ResponsiveContainer>
            </div>
          </div>
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
                {levelDistribution.map((_entry, index) => (
                  <Cell key={index} fill={donutColors[index % donutColors.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
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
                {studyModes.map((_entry, index) => (
                  <Cell key={index} fill={studyModeColors[index % studyModeColors.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Price Over Time - Full Width */}
        <div className="chartCard fullWidth">
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
                  {availableSubjects.map((course) => (
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
                name="Home Fees"
              />
              <Line
                type="monotone"
                dataKey="international"
                stroke="#c9a3cc"
                strokeWidth={3}
                name="International Fees"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>
    </main>
  );
}

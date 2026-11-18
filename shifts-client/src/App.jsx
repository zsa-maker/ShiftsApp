import { useState, useRef, useEffect, useMemo } from 'react';
import Draggable from 'react-draggable';
import { Calendar, dateFnsLocalizer } from 'react-big-calendar';
import { format, parse, startOfWeek, getDay } from 'date-fns';
import he from 'date-fns/locale/he';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import './App.css';
import { FiPlus, FiUpload, FiSettings, FiEye, FiEyeOff } from 'react-icons/fi';

// זיהוי אוטומטי של כתובת השרת: עובד גם ב-Vite (פורט 5173) וגם מהטלפון/שרת מאוחד
const API_BASE =
  typeof window !== 'undefined' && window.location.port === '5173'
    ? `http://${window.location.hostname}:3001`
    : '';

const locales = { 'he': he };
const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { weekStartsOn: 0 }),
  getDay,
  locales,
});

const formatDateHe = (dateStr) => {
  if (!dateStr) return 'לא הוגדר';
  const parts = dateStr.split('-');
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  return dateStr;
};

// שליפת חגים דינאמית מ-Hebcal
const fetchHebrewHolidayDynamic = async (startDateStr, endDateStr) => {
  if (!startDateStr) return null;
  const year = startDateStr.split('-')[0];

  try {
    const response = await fetch(`https://www.hebcal.com/hebcal?v=1&cfg=json&year=${year}&maj=on&nx=on&lg=he`);
    const data = await response.json();

    let current = new Date(`${startDateStr.split('T')[0]}T00:00:00`);
    let end = new Date(`${(endDateStr || startDateStr).split('T')[0]}T23:59:59`);
    let holidayResults = [];

    while (current <= end) {
      const y = current.getFullYear();
      const m = String(current.getMonth() + 1).padStart(2, '0');
      const d = String(current.getDate()).padStart(2, '0');
      const dateOnly = `${y}-${m}-${d}`;

      const match = data.items && data.items.find(item => item.date === dateOnly);

      if (match) {
        const rawTitle = (match.hebrew || match.title || "").toLowerCase();

        let hName = null;
        if (rawTitle.includes("ראש השנה") || rawTitle.includes("rosh hashanah")) hName = "ראש השנה";
        else if (rawTitle.includes("כיפור") || rawTitle.includes("yom kippur")) hName = "יום כיפור";
        else if (rawTitle.includes("סוכות") || rawTitle.includes("sukkot")) hName = "סוכות";
        else if (rawTitle.includes("פסח") && (rawTitle.includes("א") || rawTitle.includes("1") || rawTitle.includes("ראשון"))) hName = "פסח א'";
        else if (rawTitle.includes("פסח") && (rawTitle.includes("ב") || rawTitle.includes("2") || rawTitle.includes("שני"))) hName = "פסח ב'";
        else if (rawTitle.includes("שבועות") || rawTitle.includes("shavuot")) hName = "שבועות";

        if (hName && !holidayResults.includes(hName)) {
          holidayResults.push(hName);
        }
      }

      current.setDate(current.getDate() + 1);
    }

    return holidayResults.length > 0 ? holidayResults.join(', ') : null;
  } catch (error) {
    console.error("שגיאה בשליפת חגים דינאמית:", error);
    return null;
  }
};

const getPrevPeriodStr = (periodStr) => {
  if (!periodStr) return '';
  const [half, year] = periodStr.split('.');
  if (half === '2') return `1.${year}`;
  const prevYear = (parseInt(year, 10) - 1).toString().padStart(2, '0');
  return `2.${prevYear}`;
};

const CustomToolbar = (toolbar) => {
  const { theme } = toolbar;
  const goToBack = () => toolbar.onNavigate('PREV');
  const goToNext = () => toolbar.onNavigate('NEXT');
  const goToCurrent = () => toolbar.onNavigate('TODAY');

  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', background: theme.backgroundcolor, padding: '10px 20px', borderRadius: '12px' }}>
      <button onClick={goToCurrent} style={{ padding: '8px 16px', background: theme.pink, color: theme.darkgreen, border: `1px solid ${theme.darkgreen}`, borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', transition: 'background 0.2s' }}>
        היום
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
        <button onClick={goToBack} style={{ padding: '4px 12px', fontSize: "26px", background: 'transparent', border: "none", color: theme.darkgreen, borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>
          ▶
        </button>
        <span style={{ fontSize: '1.4rem', fontWeight: 'bold', color: theme.darkgreen, minWidth: '140px', textAlign: 'center' }}>
          {toolbar.label}
        </span>
        <button onClick={goToNext} style={{ padding: '4px 12px', fontSize: "26px", background: 'transparent', border: "none", color: theme.darkgreen, borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>
          ◀
        </button>
      </div>

      <div style={{ width: '65px' }} />
    </div>
  );
};

const theme = {
  backgroundcolor: '#F8F2E4',
  darkgreen: '#28593C',
  lightgreen: '#4D6B4F',
  pink: '#E8B0BD',
};

function App() {
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const savedUser = localStorage.getItem('app_user');
      return savedUser ? JSON.parse(savedUser) : null;
    } catch (e) {
      return null;
    }
  });

  const [loginName, setLoginName] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [shifts, setShifts] = useState([]);
  const [constraints, setConstraints] = useState([]);
  const [isUnpublishModalOpen, setIsUnpublishModalOpen] = useState(false);
  const [unpublishFormData, setUnpublishFormData] = useState({ startDate: '', endDate: '' });
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingShiftId, setEditingShiftId] = useState(null);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [availableDivisions, setAvailableDivisions] = useState([]);
  const [isConstraintModalOpen, setIsConstraintModalOpen] = useState(false);
  const [constraintFormData, setConstraintFormData] = useState({ startDate: '', endDate: '', userId: '', division: '', reason: '' });
  const [viewMode, setViewMode] = useState('calendar');
  const [isPublishModalOpen, setIsPublishModalOpen] = useState(false);
  const [publishFormData, setPublishFormData] = useState({ startDate: '', endDate: '' });
  const [isPublishChoiceOpen, setIsPublishChoiceOpen] = useState(false);
  const [isDuplicateModalOpen, setIsDuplicateModalOpen] = useState(false);
  const [duplicateFormData, setDuplicateFormData] = useState({ startDate: '', endDate: '', userId: '' });
  const [shiftToDuplicate, setShiftToDuplicate] = useState(null);
  const [exemptionTypes, setExemptionTypes] = useState([]);
  const [selectedPeriod, setSelectedPeriod] = useState("2026-07");
  const nodeRef = useRef(null);
  const [statsDate, setStatsDate] = useState(new Date());
  const [currentPeriod] = useState('2.26');

  const [squadrons, setSquadrons] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [isSplitModalOpen, setIsSplitModalOpen] = useState(false);
  const [splitDate, setSplitDate] = useState('');
  const [currentScreen, setCurrentScreen] = useState('calendar');
  const [newUserName, setNewUserName] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [isPanelOpen, setIsPanelOpen] = useState(true);
  const [newUserReleaseDate, setNewUserReleaseDate] = useState('');
  const [newUserPotential, setNewUserPotential] = useState(100);
  const [replacementData, setReplacementData] = useState({
    shift_id: '',
    start_date: '',
    end_date: '',
    type: 'pet'
  });
  const [newUserExemptionIds, setNewUserExemptionIds] = useState([]);
  const [isPetModalOpen, setIsPetModalOpen] = useState(false);
  const [selectedSlotDates, setSelectedSlotDates] = useState(null);
  const [adminMyName, setAdminMyName] = useState('');
  const [adminMyPassword, setAdminMyPassword] = useState('');
  const [adminDoesShifts, setAdminDoesShifts] = useState(false);
  const [editingSoldier, setEditingSoldier] = useState(null);
  const [isReplacementModalOpen, setIsReplacementModalOpen] = useState(false);
  const [replacementForm, setReplacementForm] = useState({
    type: 'pet',
    startDate: '',
    endDate: '',
    startTime: '',
    endTime: ''
  });
  const [shiftTypeForm, setShiftTypeForm] = useState({
    name: '',
    isWeekend: false,
    color: '#3174ad',
    points_base: 1.0
  });
  const [newUserDivision, setNewUserDivision] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [newUserGender, setNewUserGender] = useState('male');
  const [newShiftTypeGenderLimit, setNewShiftTypeGenderLimit] = useState('all');
  const [squadronName, setSquadronName] = useState('');
  const [constraintTarget, setConstraintTarget] = useState('soldier');
  const [adminName, setAdminName] = useState('');
  const [shiftExemptions, setShiftExemptions] = useState([]);
  const [adminPassword, setAdminPassword] = useState('');
  const [managingSquadron, setManagingSquadron] = useState(null);
  const [squadronUsers, setSquadronUsers] = useState([]);
  const [hasReplacement, setHasReplacement] = useState(false);
  const [formData, setFormData] = useState({ startDate: '', endDate: '', userId: '', shiftTypeId: '', isWeekend: false, isBaltam: false, notes: '' });
  const [users, setUsers] = useState([]);
  const [shiftTypes, setShiftTypes] = useState([]);
  const [customPeriods, setCustomPeriods] = useState([
    { name: '1.26', startDate: '2026-01-01', endDate: '2026-07-10' },
    { name: '2.26', startDate: '2026-07-11', endDate: '2027-01-10' }
  ]);

  const handlePrevStatsPeriod = () => {
    const newDate = new Date(statsDate);
    newDate.setMonth(newDate.getMonth() - 6);
    setStatsDate(newDate);
  };

  const handleNextStatsPeriod = () => {
    const newDate = new Date(statsDate);
    newDate.setMonth(newDate.getMonth() + 6);
    setStatsDate(newDate);
  };

  const fetchSquadrons = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/squadrons-with-admin`);
      const data = await res.json();
      setSquadrons(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("שגיאה במשיכת טייסות:", err);
    }
  };

  const getPeriodStr = (dateInput) => {
    if (!dateInput) return '';
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return '';

    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const dateOnly = `${year}-${month}-${day}`;

    const matchedPeriod = customPeriods.find(p => p.startDate && p.endDate && dateOnly >= p.startDate && dateOnly <= p.endDate);
    if (matchedPeriod) return matchedPeriod.name;

    const shortYear = year.toString().slice(-2);
    const half = d.getMonth() < 6 ? '1' : '2';
    return `${half}.${shortYear}`;
  };

  const selectedUserObj = users.find(u => String(u.id) === String(selectedUserId));
  const displayedPeriodStr = getPeriodStr(statsDate);

  const fetchShifts = () => {
    if (!currentUser) return;
    const orgQuery = currentUser.organization_id ? `?org_id=${currentUser.organization_id}` : '';
    fetch(`${API_BASE}/api/shifts${orgQuery}`)
      .then(res => res.json())
      .then(async data => {
        if (!Array.isArray(data)) return;
        let filteredData = data;
        if (currentUser.role === 'soldier') {
          filteredData = data.filter(shift => shift.is_published === 1);
        }
        const formattedShifts = await Promise.all(filteredData.map(async shift => {
          const hName = await fetchHebrewHolidayDynamic(shift.start_date, shift.end_date);
          return {
            ...shift,
            id: shift.id,
            userId: shift.user_id,
            groupId: shift.group_id,
            shiftTypeId: shift.shift_type_id,
            originalStart: shift.start_date,
            originalEnd: shift.end_date,
            holidayName: hName,
            isHoliday: !!hName,
            title: !shift.user_id
              ? `⚠️ דרוש שיבוץ - ${shift.type_name}`
              : `${shift.full_name} - ${shift.type_name}${hName ? ` (${hName})` : ''}${shift.is_published === 1 ? '' : ' (טיוטה)'}`,
            start: new Date(`${shift.start_date.split('T')[0]}T00:00:00`),
            end: new Date(`${shift.end_date.split('T')[0]}T23:59:59`),
            allDay: true,
            isPublished: shift.is_published === 1,
            isWeekend: shift.is_weekend === 1,
            isBaltam: shift.is_baltam === 1,
            type: 'shift',
            notes: shift.notes
          };
        }));

        setShifts(formattedShifts);
      })
      .catch(err => console.error(err));
  };

  const handleUnpublishBoard = () => {
    if (!unpublishFormData.startDate || !unpublishFormData.endDate) {
      alert('חובה למלא טווח תאריכים לביטול הפרסום!');
      return;
    }

    fetch(`${API_BASE}/api/shifts/unpublish-range`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        start_date: unpublishFormData.startDate,
        end_date: unpublishFormData.endDate,
        organization_id: currentUser?.organization_id
      })
    })
      .then(res => {
        if (!res.ok) throw new Error('שגיאה בביטול הפרסום');
        return res.json();
      })
      .then(data => {
        alert(data.message);
        setIsUnpublishModalOpen(false);
        setUnpublishFormData({ startDate: '', endDate: '' });
        fetchShifts();
      })
      .catch(err => {
        console.error(err);
        alert('קרתה שגיאה בתקשורת עם השרת');
      });
  };

  const fetchConstraints = () => {
    if (!currentUser) return;
    const orgQuery = currentUser.organization_id ? `?org_id=${currentUser.organization_id}` : '';
    fetch(`${API_BASE}/api/constraints${orgQuery}`)
      .then(res => res.json())
      .then(data => {
        if (!Array.isArray(data)) return;
        const formattedConstraints = data.map(c => {
          let targetName = 'כללי';

          if (c.division && c.division !== 'לא מוגדר' && c.division.trim() !== '') {
            targetName = `גף ${c.division}`;
          } else if (c.full_name) {
            targetName = c.full_name;
          }

          return {
            id: `c-${c.id}`,
            dbId: c.id,
            userId: c.user_id,
            division: c.division,
            originalStart: c.start_date,
            originalEnd: c.end_date,
            title: `אילוץ: ${targetName} - ${c.reason}`,
            start: new Date(`${c.start_date.split('T')[0]}T00:00:00`),
            end: new Date(`${c.end_date.split('T')[0]}T23:59:59`),
            allDay: true,
            type: 'constraint'
          };
        });
        setConstraints(formattedConstraints);
      })
      .catch(err => console.error("שגיאה במשיכת אילוצים:", err));
  };

  const fetchUsers = (orgId) => {
    const idToUse = orgId || currentUser?.organization_id;
    if (!idToUse) return;

    fetch(`${API_BASE}/api/users?org_id=${idToUse}`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setUsers(data);
      })
      .catch(err => console.error("שגיאה במשיכת משתמשים:", err));
  };

  const fetchShiftTypes = (orgId) => {
    const idToUse = orgId || currentUser?.organization_id;
    const orgQuery = idToUse ? `?org_id=${idToUse}` : '';
    fetch(`${API_BASE}/api/shift-types${orgQuery}`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setShiftTypes(data);
      })
      .catch(err => console.error("שגיאה במשיכת סוגי תורנויות:", err));
  };

  const fetchShiftExemptions = () => {
    fetch(`${API_BASE}/api/shift-exemptions`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setShiftExemptions(data);
      })
      .catch(err => console.error("שגיאה במשיכת החלפות:", err));
  };

  useEffect(() => {
    fetchSquadrons();
  }, []);

  useEffect(() => {
    if (currentUser) {
      const orgId = currentUser.organization_id;
      if (orgId) {
        fetchUsers(orgId);
      }

      fetchShifts();
      fetchConstraints();
      fetchShiftTypes(orgId);
      fetchShiftExemptions();

      fetch(`${API_BASE}/api/exemption-types`)
        .then(res => res.json())
        .then(data => {
          if (Array.isArray(data)) setExemptionTypes(data);
        })
        .catch(err => console.error("שגיאה במשיכת סוגי פטורים:", err));

      setAdminMyName(currentUser.full_name || '');
      setAdminDoesShifts(currentUser.does_shifts === 1);
    }
  }, [currentUser]);

  useEffect(() => {
    if (currentUser && currentUser.organization_id) {
      fetch(`${API_BASE}/api/periods/${currentUser.organization_id}`)
        .then(res => res.json())
        .then(data => {
          if (Array.isArray(data) && data.length > 0) {
            setCustomPeriods(data.map(p => ({
              name: p.name,
              startDate: p.start_date,
              endDate: p.end_date
            })));
          }
        })
        .catch(err => console.error("שגיאה בטעינת תקופות:", err));
    }
  }, [currentUser]);

  useEffect(() => {
    if (currentUser) {
      fetch(`${API_BASE}/api/shift-exemptions/cleanup`, { method: 'DELETE' })
        .catch(err => console.error("שגיאה בניקוי החלפות יתומות:", err));
    }
  }, [currentUser]);

  const handleLogout = () => {
    localStorage.removeItem('app_user');
    setCurrentUser(null);
  };

  const handleConnectCalendar = () => {
    fetch(`${API_BASE}/api/calendar/auth-url?userId=${currentUser.id}`)
      .then(res => res.json())
      .then(data => {
        window.location.href = data.url;
      })
      .catch(err => console.error("שגיאה ביצירת קישור ליומן:", err));
  };

  const handleLogin = (e) => {
    e.preventDefault();
    fetch(`${API_BASE}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_name: loginName, password: loginPassword })
    })
      .then(res => {
        if (!res.ok) throw new Error('שם משתמש או סיסמה שגויים ❌');
        return res.json();
      })
      .then(data => {
        setCurrentUser(data.user);
        localStorage.setItem('app_user', JSON.stringify(data.user));
      })
      .catch(err => alert(err.message));
  };

  const handleDateSelection = (formType, field, value) => {
    let currentForm, setForm;
    if (formType === 'shift') { currentForm = formData; setForm = setFormData; }
    else if (formType === 'constraint') { currentForm = constraintFormData; setForm = setConstraintFormData; }
    else if (formType === 'publish') { currentForm = publishFormData; setForm = setPublishFormData; }
    else if (formType === 'duplicate') { currentForm = duplicateFormData; setForm = setDuplicateFormData; }
    else if (formType === 'unpublish') { currentForm = unpublishFormData; setForm = setUnpublishFormData; }

    let newStartDate = field === 'startDate' ? value : currentForm.startDate;
    let newEndDate = field === 'endDate' ? value : currentForm.endDate;

    if (newStartDate && newEndDate && newEndDate < newStartDate) {
      alert('⚠️ שגיאה: תאריך הסיום לא יכול להיות לפני תאריך ההתחלה!');
      newEndDate = '';
    }
    setForm({ ...currentForm, startDate: newStartDate, endDate: newEndDate });
  };

  const handleSaveConstraint = () => {
    if (!constraintFormData.startDate || !constraintFormData.endDate) {
      alert('חובה למלא תאריכים!');
      return;
    }

    fetch(`${API_BASE}/api/constraints`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        organization_id: currentUser.organization_id,
        user_id: constraintTarget === 'soldier' ? constraintFormData.userId : null,
        division: constraintTarget === 'division' ? constraintFormData.division : null,
        constraint_type: constraintTarget,
        start_date: constraintFormData.startDate,
        end_date: constraintFormData.endDate,
        reason: constraintFormData.reason
      })
    }).then(() => {
      setIsConstraintModalOpen(false);
      fetchConstraints();
    });
  };

  const handleDeleteConstraint = (dbId) => {
    if (!window.confirm('למחוק את האילוץ?')) return;
    fetch(`${API_BASE}/api/constraints/${dbId}`, { method: 'DELETE' })
      .then(() => fetchConstraints());
  };

  const deleteSquadron = async (id) => {
    if (!window.confirm("למחוק את הטייסת וכל נתוניה לצמיתות?")) return;
    try {
      const res = await fetch(`${API_BASE}/api/organizations/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setSquadrons(squadrons.filter(s => s.id !== id));
        setManagingSquadron(null);
      } else {
        alert("שגיאה במחיקת הטייסת");
      }
    } catch (err) {
      console.error("שגיאה במחיקת טייסת:", err);
    }
  };

  const handleSaveUser = () => {
    if (!newUserName || !newUserPassword) {
      alert('חובה למלא שם וסיסמה!');
      return;
    }

    fetch(`${API_BASE}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        organization_id: currentUser.organization_id,
        full_name: newUserName,
        password: newUserPassword,
        role: 'soldier',
        does_shifts: 1,
        is_active: 1,
        release_date: newUserReleaseDate,
        gender: newUserGender,
        exemptionIds: newUserExemptionIds || [],
        potential_reduction: parseInt(newUserPotential, 10) || 100,
        division: newUserDivision
      })
    })
      .then(res => res.json())
      .then(() => {
        setNewUserName('');
        setNewUserPassword('');
        setNewUserReleaseDate('');
        setNewUserPotential(100);
        setNewUserExemptionIds([]);
        setNewUserGender('male');
        setNewUserDivision('');
        alert('החייל גויס בהצלחה! 🧑‍✈️');
        fetchUsers(currentUser.organization_id);
      })
      .catch(err => console.error("שגיאה בהוספת חייל:", err));
  };

  const doesRangeContainShabbat = (start, end) => {
    if (!start || !end) return false;

    let currentDate = new Date(`${start.split('T')[0]}T00:00:00`);
    const endDate = new Date(`${end.split('T')[0]}T23:59:59`);

    while (currentDate <= endDate) {
      if (currentDate.getDay() === 6) return true;
      currentDate.setDate(currentDate.getDate() + 1);
    }
    return false;
  };

  const handleUpdateOneself = () => {
    if (!currentUser) return;

    const newDoesShiftsValue = adminDoesShifts ? 1 : 0;

    fetch(`${API_BASE}/api/users/${currentUser.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: adminMyName,
        password: adminMyPassword,
        release_date: currentUser.release_date,
        potential_reduction: currentUser.potential_reduction,
        exemptionIds: currentUser.exemptionIds || [],
        does_shifts: newDoesShiftsValue
      })
    })
      .then(res => res.json())
      .then(() => {
        alert('הפרטים עודכנו בהצלחה!');
        const updatedUser = {
          ...currentUser,
          full_name: adminMyName,
          does_shifts: newDoesShiftsValue
        };
        setCurrentUser(updatedUser);
        localStorage.setItem('app_user', JSON.stringify(updatedUser));
        setAdminMyPassword('');
        fetchUsers(currentUser.organization_id);
      })
      .catch(err => console.error("שגיאה בעדכון:", err));
  };

  // התראה מיידית בעת שינוי שדות בטופס
  const checkConflict = (userId, start, end, shiftTypeId) => {
    const result = validateShift(userId, shiftTypeId, start, end, doesRangeContainShabbat(start, end));
    if (result !== true) {
      alert(`⚠️ התראה: ${result}`);
    }
  };

  // סינון רשימת החיילים כך שיציג רק חיילים זמינים (או יסמן חסומים)
  const getAvailableSoldiers = (startDate = formData.startDate, endDate = formData.endDate, shiftTypeId = formData.shiftTypeId) => {
    return users.filter(u => {
      if (u.is_active !== 1 || u.does_shifts !== 1) return false;
      // אם נבחרו תאריכים או סוג תורנות, סנן חיילים שיש להם אילוץ או פטור מתאים
      if (startDate && endDate) {
        const isValid = validateShift(u.id, shiftTypeId, startDate, endDate, doesRangeContainShabbat(startDate, endDate));
        // משאירים ברשימה את החייל שכבר משובץ לתורנות הנוכחית בעריכה, אך מסננים אחרים שחסומים
        if (isValid !== true && String(u.id) !== String(formData.userId)) {
          return false;
        }
      }
      return true;
    });
  };

  const handleUpdateSoldier = (id, fullName, password, releaseDate, potentialReduction, exemptionIds) => {
    if (!fullName) {
      alert('השם לא יכול להיות ריק!');
      return;
    }

    fetch(`${API_BASE}/api/users/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: fullName,
        password: password,
        release_date: releaseDate || null,
        potential_reduction: parseInt(potentialReduction, 10) || 100,
        does_shifts: editingSoldier.does_shifts,
        exemptionIds: exemptionIds || []
      })
    })
      .then(res => {
        if (!res.ok) throw new Error("שגיאה בעדכון");
        return res.json();
      })
      .then(() => {
        alert('נתוני החייל עודכנו בהצלחה! 💾');
        fetchUsers(currentUser.organization_id);
        setEditingSoldier(null);
      })
      .catch(err => {
        console.error("שגיאה:", err);
        alert("לא ניתן היה לעדכן את הפטורים.");
      });
  };

  const handleDeleteSoldier = (id) => {
    const userObj = users.find(u => u.id === id);
    const msg = `⚠️ אזהרה! ⚠️\n\nאת עומדת למחוק את "${userObj?.full_name}".\n\n- כל התורנויות העתידיות שלו יהפכו ל"דרוש שיבוץ".\n- היסטוריית התורנויות שלו תישמר בסטטיסטיקות.\n\nהאם להמשיך?`;

    if (!window.confirm(msg)) return;

    fetch(`${API_BASE}/api/users/${id}`, { method: 'DELETE' })
      .then(() => {
        fetchUsers();
        fetchShifts();
        if (selectedUserId === id) setSelectedUserId(null);
      })
      .catch(err => console.error("שגיאה במחיקה:", err));
  };

  const handleSaveShiftType = async () => {
    if (!shiftTypeForm.name) {
      alert('חובה למלא שם סוג תורנות!');
      return;
    }

    const colorToSave = shiftTypeForm.color || '#3174ad';

    try {
      const response = await fetch(`${API_BASE}/api/shift-types`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organization_id: currentUser.organization_id,
          name: shiftTypeForm.name,
          is_weekend: 0,
          color: colorToSave,
          points_base: shiftTypeForm.points_base || 1.0,
          gender_limit: newShiftTypeGenderLimit || 'all'
        })
      });

      if (!response.ok) throw new Error("שגיאה בשמירת סוג התורנות");

      setShiftTypeForm({ name: '', isWeekend: false, color: '#3174ad', points_base: 1.0 });
      setNewShiftTypeGenderLimit('all');
      alert('סוג תורנות נוצר בהצלחה!');
      fetchShiftTypes(currentUser.organization_id);
    } catch (err) {
      console.error("שגיאה ביצירת סוג תורנות:", err);
      alert("קרתה שגיאה, נסי שוב");
    }
  };

  const checkIsDateWithinWeek = (targetDate) => {
    if (!targetDate) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const shiftDate = new Date(`${targetDate.split('T')[0]}T00:00:00`);
    const diffDays = Math.ceil((shiftDate.getTime() - today.getTime()) / (1000 * 3600 * 24));
    return diffDays >= 0 && diffDays <= 7;
  };

  const forcedBaltam = !editingShiftId && checkIsDateWithinWeek(formData.startDate);
  const displayBaltam = forcedBaltam || formData.isBaltam;

  // בדיקה מרכזית של פטורים ואילוצים עבור חייל, טווח תאריכים וסוג תורנות
  const validateShift = (userId, shiftTypeId, startDate = formData.startDate, endDate = formData.endDate, isWeekendFlag = formData.isWeekend) => {
    if (!userId || !startDate || !endDate) return true;

    const selectedUser = users.find(u => String(u.id) === String(userId));
    if (!selectedUser) return true;

    const selectedType = shiftTypes.find(t => String(t.id) === String(shiftTypeId));
    const sStart = new Date(`${startDate.split('T')[0]}T00:00:00`);
    const sEnd = new Date(`${endDate.split('T')[0]}T23:59:59`);

    // 1. בדיקת תאריך שחרור
    if (selectedUser.release_date) {
      const releaseDate = new Date(`${selectedUser.release_date.split('T')[0]}T00:00:00`);
      if (sEnd > releaseDate) {
        return `החייל ${selectedUser.full_name} משתחרר בתאריך ${formatDateHe(selectedUser.release_date)}!`;
      }
    }
    // 2. בדיקת אילוצים (חייל ספציפי, גף, או כלל הטייסת)
    const conflictingConstraint = constraints.find(c => {
      const cStart = new Date(`${c.originalStart.split('T')[0]}T00:00:00`);
      const cEnd = new Date(`${c.originalEnd.split('T')[0]}T23:59:59`);
      const isOverlapping = sStart <= cEnd && sEnd >= cStart;
      if (!isOverlapping) return false;

      // אילוץ של החייל עצמו
      if (c.userId && String(c.userId) === String(selectedUser.id)) return true;

      // אילוץ של הגף של החייל
      if (
        c.division &&
        c.division !== 'לא מוגדר' &&
        c.division.trim() !== '' &&
        selectedUser.division &&
        c.division.trim() === selectedUser.division.trim()
      ) {
        return true;
      }

      // אילוץ טייסתי כללי (ללא חייל וללא גף)
      if (!c.userId && (!c.division || c.division === 'לא מוגדר' || c.division.trim() === '')) {
        return true;
      }

      return false;
    });

    if (conflictingConstraint) {
      return `קיים אילוץ בתאריכים אלו (${conflictingConstraint.title})!`;
    }

    // 3. חילוץ שמות ומזהי הפטורים של החייל (תומך גם ב-String וגם ב-Number)
    const rawExemptions = selectedUser.exemptionIds || [];
    const userExemptionIdsStr = rawExemptions.map(id => String(id));
    const userExemptionNames = rawExemptions.map(id => {
      const found = exemptionTypes.find(e => String(e.id) === String(id));
      return found ? found.name : String(id);
    });

    const hasExemption = (idNum, keyword) =>
      userExemptionIdsStr.includes(String(idNum)) ||
      userExemptionNames.some(name => name.includes(keyword));

    // 4. בדיקת פטור שבתות
    const isShabbatInRange = isWeekendFlag || doesRangeContainShabbat(startDate, endDate);
    if (isShabbatInRange && hasExemption(4, 'שבת')) {
      return `ל-${selectedUser.full_name} יש פטור שבתות!`;
    }

    // 5. בדיקות תלויות סוג תורנות (מטבח, שמירות, רס"ר, מגדר)
    if (selectedType) {
      const typeName = selectedType.name || '';

      if (typeName.includes('מטבח') && hasExemption(1, 'מטבח')) {
        return `ל-${selectedUser.full_name} יש פטור מטבח!`;
      }
      if (typeName.includes('שמיר') && hasExemption(2, 'שמיר')) {
        return `ל-${selectedUser.full_name} יש פטור שמירות!`;
      }
      if ((typeName.includes('רס"ר') || typeName.includes('רסר')) && (hasExemption(3, 'רס"ר') || hasExemption(3, 'רסר'))) {
        return `ל-${selectedUser.full_name} יש פטור רס"ר!`;
      }

      if (
        selectedType.gender_limit &&
        selectedType.gender_limit !== 'all' &&
        selectedUser.gender &&
        selectedType.gender_limit !== selectedUser.gender
      ) {
        return `תורנות זו מוגדרת עבור ${selectedType.gender_limit === 'male' ? 'בנים בלבד' : 'בנות בלבד'}!`;
      }
    }

    return true;
  };

  const handleSaveShift = async () => {
    const validationResult = validateShift(formData.userId, formData.shiftTypeId);
    if (validationResult !== true) {
      alert(`⚠️ שיבוץ לא תקין: ${validationResult}`);
      return;
    }
    if (!formData.startDate || !formData.endDate || !formData.shiftTypeId) {
      alert('שדות חובה!');
      return;
    }
    const method = editingShiftId ? 'PUT' : 'POST';
    const url = editingShiftId ? `${API_BASE}/api/shifts/${editingShiftId}` : `${API_BASE}/api/shifts`;
    const finalBaltam = forcedBaltam ? true : formData.isBaltam;
    const holiday = await fetchHebrewHolidayDynamic(formData.startDate, formData.endDate);

    fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        organization_id: currentUser.organization_id,
        user_id: formData.userId || null,
        shift_type_id: formData.shiftTypeId,
        start_date: formData.startDate,
        end_date: formData.endDate,
        is_weekend: formData.isWeekend,
        is_baltam: finalBaltam,
        notes: formData.notes,
        holiday_name: holiday
      })
    }).then(() => {
      setIsModalOpen(false);
      fetchShifts();
    });
  };

  const handleSplitShift = async () => {
    if (!splitDate) {
      alert('נא לבחור תאריך לפיצול!');
      return;
    }

    const shiftType = shiftTypes.find(t => String(t.id) === String(formData.shiftTypeId));
    const isGuardShift = shiftType && shiftType.name.includes('שמיר');

    const timeToSplit = isGuardShift ? '14:00:00' : '00:00:00';
    const splitPoint = new Date(`${splitDate}T${timeToSplit}`);
    const originalStart = new Date(`${formData.startDate}T00:00:00`);
    const originalEnd = new Date(`${formData.endDate}T23:59:59`);

    if (splitPoint <= originalStart || splitPoint >= originalEnd) {
      alert('תאריך הפיצול חייב להיות בתוך טווח התורנות!');
      return;
    }

    const originalShift = shifts.find(s => String(s.id) === String(editingShiftId));
    const sharedGroupId = originalShift?.groupId || `grp_split_${Date.now()}`;

    const firstPartEndStr = splitDate;
    const isFirstPartWeekend = doesRangeContainShabbat(formData.startDate, firstPartEndStr);
    const isSecondPartWeekend = doesRangeContainShabbat(splitDate, formData.endDate);

    try {
      await fetch(`${API_BASE}/api/shifts/${editingShiftId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organization_id: currentUser.organization_id,
          user_id: formData.userId,
          shift_type_id: formData.shiftTypeId,
          start_date: formData.startDate,
          end_date: firstPartEndStr,
          is_weekend: isFirstPartWeekend,
          is_baltam: formData.isBaltam,
          notes: formData.notes,
          group_id: sharedGroupId
        })
      });

      await fetch(`${API_BASE}/api/shifts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organization_id: currentUser.organization_id,
          user_id: null,
          shift_type_id: formData.shiftTypeId,
          start_date: splitDate,
          end_date: formData.endDate,
          is_weekend: isSecondPartWeekend,
          is_baltam: formData.isBaltam,
          notes: formData.notes,
          group_id: sharedGroupId
        })
      });

      alert('התורנות פוצלה בהצלחה! ✂️');
      setIsSplitModalOpen(false);
      setIsModalOpen(false);
      fetchShifts();
    } catch (err) {
      console.error(err);
      alert('שגיאה בתהליך הפיצול');
    }
  };

  const handleDelete = async () => {
    try {
      const originalShiftId = editingShiftId ? editingShiftId.toString().split('-')[0] : null;
      const existingExemption = shiftExemptions.find(ex => String(ex.shift_id) === String(originalShiftId));

      if (existingExemption) {
        await fetch(`${API_BASE}/api/shift-exemptions/${existingExemption.id}`, {
          method: 'DELETE'
        });
      }

      const response = await fetch(`${API_BASE}/api/shifts/${originalShiftId}`, {
        method: 'DELETE'
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'משהו השתבש במחיקה');
      }

      setIsModalOpen(false);
      fetchShifts();
      fetchShiftExemptions();
    } catch (error) {
      console.error("שגיאת מחיקה:", error.message);
      alert("לא ניתן היה למחוק את התורנות: " + error.message);
    }
  };

  const handleDuplicateClick = () => {
    setShiftToDuplicate({
      userId: formData.userId,
      shiftTypeId: formData.shiftTypeId,
      isWeekend: formData.isWeekend,
      isBaltam: formData.isBaltam
    });
    setDuplicateFormData({ startDate: '', endDate: '', userId: formData.userId });
    setIsModalOpen(false);
    setIsDuplicateModalOpen(true);
  };

const handleSaveDuplicate = () => {
    if (!duplicateFormData.startDate || !duplicateFormData.endDate || !duplicateFormData.userId) {
      alert('חובה למלא תאריכים וחייל!');
      return;
    }

    const isWeekendDup = doesRangeContainShabbat(duplicateFormData.startDate, duplicateFormData.endDate);
    const validationResult = validateShift(
      duplicateFormData.userId,
      shiftToDuplicate.shiftTypeId,
      duplicateFormData.startDate,
      duplicateFormData.endDate,
      isWeekendDup
    );

    if (validationResult !== true) {
      alert(`⚠️ שיבוץ לא תקין: ${validationResult}`);
      return;
    }

    const isWithinWeek = checkIsDateWithinWeek(duplicateFormData.startDate);
    const finalBaltam = isWithinWeek ? true : shiftToDuplicate.isBaltam;

    fetch(`${API_BASE}/api/shifts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        organization_id: currentUser.organization_id,
        user_id: duplicateFormData.userId,
        shift_type_id: shiftToDuplicate.shiftTypeId,
        start_date: duplicateFormData.startDate,
        end_date: duplicateFormData.endDate,
        is_weekend: isWeekendDup,
        is_baltam: finalBaltam
      })
    }).then(() => {
      setIsDuplicateModalOpen(false);
      setShiftToDuplicate(null);
      fetchShifts();
    });
  };

  const handlePublishBoard = () => {
    if (!publishFormData.startDate || !publishFormData.endDate) {
      alert('חובה למלא טווח תאריכים!');
      return;
    }

    fetch(`${API_BASE}/api/shifts/publish-range`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        start_date: publishFormData.startDate,
        end_date: publishFormData.endDate,
        organization_id: currentUser?.organization_id
      })
    })
      .then(res => res.json())
      .then(data => {
        alert(data.message);
        setIsPublishModalOpen(false);
        setPublishFormData({ startDate: '', endDate: '' });
        fetchShifts();
      })
      .catch(err => console.error("שגיאה:", err));
  };

  const deleteReplacement = async (exemptionId) => {
    try {
      const response = await fetch(`${API_BASE}/api/shift-exemptions/${exemptionId}`, {
        method: 'DELETE'
      });

      if (!response.ok) throw new Error("שגיאה במחיקת ההחלפה");

      alert("ההחלפה הוסרה והתורנות המקורית חזרה");
      fetchShiftExemptions();
    } catch (err) {
      console.error(err);
    }
  };

  const handleEventClick = (event) => {
    if (currentUser.role !== 'admin') {
      return;
    }

    if (event.type === 'exemption') {
      const e = event.exemptionData;
      if (!e || !e.id) return;

      const confirmDelete = window.confirm("האם ברצונך למחוק את ההחלפה הזו מהלוח ולהחזיר את התורנות המקורית?");
      if (confirmDelete) {
        deleteReplacement(e.id);
      }
      return;
    }

    if (event.type === 'constraint') {
      handleDeleteConstraint(event.dbId);
      return;
    }

    if (event.type === 'shift') {
      const originalShiftId = event.id ? event.id.toString().split('-')[0] : null;

      const existingExemption = Array.isArray(shiftExemptions)
        ? shiftExemptions.find(ex => ex.shift_id && String(ex.shift_id) === String(originalShiftId))
        : null;

      if (existingExemption) {
        setHasReplacement(true);
        setReplacementData({
          id: existingExemption.id,
          shift_id: existingExemption.shift_id,
          start_date: existingExemption.start_date,
          end_date: existingExemption.end_date,
          type: existingExemption.type
        });
      } else {
        setHasReplacement(false);
        setReplacementData({ shift_id: originalShiftId, start_date: '', end_date: '', type: 'pet' });
      }

      setEditingShiftId(originalShiftId);
      setFormData({
        startDate: event.originalStart,
        endDate: event.originalEnd,
        userId: event.userId || '',
        shiftTypeId: event.shiftTypeId || '',
        isWeekend: doesRangeContainShabbat(event.originalStart, event.originalEnd),
        isBaltam: Boolean(event.isBaltam),
        notes: event.notes || ''
      });
      setIsModalOpen(true);
    }
  };

  const handleSelectSlot = (slotInfo) => {
    if (currentUser.role !== 'admin') {
      return;
    }

    const startDateStr = format(slotInfo.start, 'yyyy-MM-dd');
    const adjustedEnd = new Date(slotInfo.end);
    adjustedEnd.setMinutes(adjustedEnd.getMinutes() - 1);
    const endDateStr = format(adjustedEnd, 'yyyy-MM-dd');

    setSelectedSlotDates({ startDate: startDateStr, endDate: endDateStr });
  };

  const eventStyleGetter = (event) => {
    // 0. עיצוב הקו המחבר בין תאריך התחלה לסיום על גבי לוח השנה עצמו
    if (event.type === 'selection-line') {
      return {
        style: {
          backgroundColor: theme.darkgreen,
          color: theme.backgroundcolor,
          border: `2px solid ${theme.pink}`,
          borderRadius: '20px',
          height: '22px',
          fontSize: '12px',
          fontWeight: 'bold',
          textAlign: 'center',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          boxShadow: '0 0 10px rgba(40, 89, 60, 0.7)',
          zIndex: 50,
          pointerEvents: 'none'
        }
      };
    }

    let finalColor = '#3174ad';

    if (event.type === 'constraint') {
      finalColor = '#c0392b';
    } else if (event.type === 'exemption') {
      finalColor = '#e67e22';
    } else if (event.type === 'shift') {
      const foundType = shiftTypes.find(t => String(t.id) === String(event.shiftTypeId));
      let color = foundType ? foundType.color : (event.type_color || '#3174ad');
      finalColor = color.startsWith('#') ? color : '#' + color;
    }

    let currentOpacity = (event.isPublished !== false) ? 1 : 0.4;
    let currentBorder = !event.userId && event.type === 'shift' ? '2px dashed #fff' : '0px';

    let currentFilter = 'none';
    if (selectedUserId) {
      if (event.userId && String(event.userId) === String(selectedUserId)) {
        currentOpacity = 1;
        currentBorder = '2px solid #000';
      } else {
        currentOpacity = 0.15;
        currentFilter = 'grayscale(100%)';
      }
    }

    return {
      style: {
        backgroundColor: finalColor,
        opacity: currentOpacity,
        border: currentBorder,
        filter: currentFilter,
        borderRadius: '8px',
        color: 'white',
        transition: 'all 0.3s ease',
        // מרכוז הכיתוב באמצע הפס של התורנות:
        textAlign: 'center',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        fontWeight: 'bold',
        padding: '2px 6px'
      }
    };
  };

  const ALL_COLORS = [
    { name: 'ירוק', value: '#27ae60' },
    { name: 'סגול', value: '#8e44ad' },
    { name: 'כתום', value: '#e67e22' },
    { name: 'אדום', value: '#c0392b' },
    { name: 'צהוב', value: '#f1c40f' },
    { name: 'כחול-סגול', value: '#513dac' },
    { name: 'תכלת', value: '#4bd4ec' }
  ];

  const getAvailableColors = () => {
    const usedColors = shiftTypes.map(st => st.color ? st.color.toLowerCase() : "");
    return ALL_COLORS.filter(colorOption => !usedColors.includes(colorOption.value.toLowerCase()));
  };

  // חיתוך אירועי לוח השנה עם סינון מדויק לפי shift_id
  const allCalendarEvents = [
    ...shifts.flatMap(s => {
      const sStart = new Date(`${s.originalStart.split('T')[0]}T00:00:00`);
      const sEnd = new Date(`${s.originalEnd.split('T')[0]}T23:59:59`);

      const overlaps = shiftExemptions.filter(e => {
        if (String(e.shift_id) !== String(s.id)) return false;
        const eStart = new Date(`${e.start_date.split('T')[0]}T00:00:00`);
        const eEnd = new Date(`${e.end_date.split('T')[0]}T23:59:59`);
        return sStart <= eEnd && sEnd >= eStart;
      });

      if (overlaps.length === 0) return [s];

      let fragments = [{ start: sStart, end: sEnd }];

      overlaps.forEach(e => {
        const eStart = new Date(`${e.start_date.split('T')[0]}T00:00:00`);
        const eEnd = new Date(`${e.end_date.split('T')[0]}T23:59:59`);

        fragments = fragments.flatMap(f => {
          if (f.end < eStart || f.start > eEnd) return [f];

          const result = [];
          if (f.start < eStart) {
            const prevDayEnd = new Date(eStart);
            prevDayEnd.setDate(prevDayEnd.getDate() - 1);
            prevDayEnd.setHours(23, 59, 59, 999);
            result.push({ start: f.start, end: prevDayEnd });
          }
          if (f.end > eEnd) {
            const nextDayStart = new Date(eEnd);
            nextDayStart.setDate(nextDayStart.getDate() + 1);
            nextDayStart.setHours(0, 0, 0, 0);
            result.push({ start: nextDayStart, end: f.end });
          }
          return result;
        });
      });

      return fragments.map(f => ({
        ...s,
        id: `${s.id}-${f.start.getTime()}`,
        start: f.start,
        end: f.end,
        title: s.title
      }));
    }),
    ...constraints,
    ...shiftExemptions.map(e => {
      const originalShift = shifts.find(s => String(s.id) === String(e.shift_id));
      if (!originalShift) return null;

      if (currentUser.role === 'soldier' && !originalShift.isPublished) {
        return null;
      }

      const typeName = originalShift.type_name || "תורנות";

      return {
        id: `ex-${e.id}`,
        userId: originalShift.userId || originalShift.user_id,
        title: `החלפה: ${typeName} | מחליף את: ${originalShift.full_name || 'לא ידוע'}`,
        start: new Date(`${e.start_date.split('T')[0]}T00:00:00`),
        end: new Date(`${e.end_date.split('T')[0]}T23:59:59`),
        allDay: true,
        type: 'exemption',
        exemptionData: e
      };
    }).filter(e => e !== null)
    // קו מחבר חי על גבי לוח השנה עצמו בזמן בחירת תאריך התחלה וסיום
    , ...(() => {
      const activeStart =
        selectedSlotDates?.startDate ||
        (isModalOpen ? formData.startDate : null) ||
        (isConstraintModalOpen ? constraintFormData.startDate : null) ||
        (isPublishModalOpen ? publishFormData.startDate : null) ||
        (isUnpublishModalOpen ? unpublishFormData.startDate : null) ||
        (isDuplicateModalOpen ? duplicateFormData.startDate : null);

      const activeEnd =
        selectedSlotDates?.endDate ||
        (isModalOpen ? formData.endDate : null) ||
        (isConstraintModalOpen ? constraintFormData.endDate : null) ||
        (isPublishModalOpen ? publishFormData.endDate : null) ||
        (isUnpublishModalOpen ? unpublishFormData.endDate : null) ||
        (isDuplicateModalOpen ? duplicateFormData.endDate : null);

      if (!activeStart || !activeEnd) return [];

      return [{
        id: 'selection-connector-line',
        title: `●━━━━━━ ${formatDateHe(activeStart)} עד ${formatDateHe(activeEnd)} ━━━━━━●`,
        start: new Date(`${activeStart.split('T')[0]}T00:00:00`),
        end: new Date(`${activeEnd.split('T')[0]}T23:59:59`),
        allDay: true,
        type: 'selection-line'
      }];
    })()
  ];

  const getWeeklySummaryData = () => {
    const summary = {};

    shifts.forEach(shift => {
      if (!shift.originalStart || shift.type === 'constraint') return;

      const shiftDate = new Date(`${shift.originalStart.split('T')[0]}T00:00:00`);
      const startOfThisWeek = startOfWeek(shiftDate, { weekStartsOn: 1 });
      const endOfThisWeek = new Date(startOfThisWeek);
      endOfThisWeek.setDate(endOfThisWeek.getDate() + 6);

      const weekKey = `${format(startOfThisWeek, 'dd/MM/yy')} - ${format(endOfThisWeek, 'dd/MM/yy')}`;

      if (!summary[weekKey]) {
        summary[weekKey] = {};
        shiftTypes.forEach(t => {
          summary[weekKey][t.id] = new Set();
        });
      }

      const uniqueId = shift.groupId || `single_${shift.id}`;
      if (summary[weekKey][shift.shiftTypeId]) {
        summary[weekKey][shift.shiftTypeId].add(uniqueId);
      }
    });

    const sortedWeeks = Object.keys(summary).sort((a, b) => {
      const dateA = a.split(' - ')[0].split('/').reverse().join('');
      const dateB = b.split(' - ')[0].split('/').reverse().join('');
      return dateA.localeCompare(dateB);
    });

    return { summary, sortedWeeks };
  };

  const handleCreateSquadronAndAdmin = async () => {
    if (!squadronName || !adminName || !adminPassword) {
      alert("נא למלא את כל השדות!");
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/api/setup-squadron`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          squadronData: { name: squadronName },
          adminData: { full_name: adminName, password: adminPassword }
        })
      });

      if (response.ok) {
        const result = await response.json();
        const newSquadron = { id: result.squadronId, name: squadronName, admin_name: adminName };
        setSquadrons([...squadrons, newSquadron]);
        setSquadronName('');
        setAdminName('');
        setAdminPassword('');
        alert('הטייסת והאחראי הוקמו בהצלחה! 🚀');
      } else {
        alert("שגיאה בהקמת הטייסת בשרת");
      }
    } catch (err) {
      console.error("שגיאה:", err);
    }
  };

  const openSquadronManagement = async (squadron) => {
    setManagingSquadron(squadron);

    try {
      const response = await fetch(`${API_BASE}/api/users?org_id=${squadron.id}`);
      const data = await response.json();
      setSquadronUsers(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("שגיאה בטעינת חיילים:", err);
    }
  };

  const { summary: weeklySummary, sortedWeeks } = getWeeklySummaryData();

  const updateAdmin = async (newAdminId) => {
    try {
      await fetch(`${API_BASE}/api/users/update-admin/${managingSquadron.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newAdminId })
      });

      setSquadronUsers(prevUsers => {
        const updatedUsers = prevUsers.map(u => {
          if (u.id === newAdminId) return { ...u, role: 'admin' };
          if (u.role === 'admin') return { ...u, role: 'soldier' };
          return u;
        });

        return updatedUsers.sort((a, b) => (a.role === 'admin' ? -1 : 1));
      });

      fetchSquadrons();
      alert("האחראי עודכן בהצלחה!");
    } catch (err) {
      console.error("שגיאה בעדכון אחראי:", err);
    }
  };

  const deleteUser = (userId) => {
    fetch(`${API_BASE}/api/users/${userId}`, { method: 'DELETE' })
      .then(res => res.json())
      .then(() => {
        if (managingSquadron) {
          setSquadronUsers(prev => prev.filter(u => u.id !== userId));
        }
        if (currentUser?.organization_id) {
          fetchUsers(currentUser.organization_id);
        }
      })
      .catch(err => console.error("שגיאה במחיקה:", err));
  };

  // === חישובי נתונים סטטיסטיים לפי התקופה הנבחרת ===
  const displayedPeriodShifts = shifts.filter(s => getPeriodStr(s.originalStart) === displayedPeriodStr);
  const totalShiftsInPeriod = displayedPeriodShifts.length;
  const activeUsersCount = users.filter(u => u.is_active === 1 && u.does_shifts === 1).length;
  const benchmarkQuota = activeUsersCount > 0 ? (totalShiftsInPeriod / activeUsersCount) : 0;

  const shiftTypeDistribution = shiftTypes.map(type => ({
    name: type.name,
    color: type.color ? (type.color.startsWith('#') ? type.color : '#' + type.color) : '#3174ad',
    count: displayedPeriodShifts.filter(s => String(s.shiftTypeId) === String(type.id)).length
  }));

  function calculateTotalPointsInPeriod(shiftsList, exemptions, typesList) {
    let totalPoints = 0;

    shiftsList.forEach(s => {
      const type = typesList.find(t => String(t.id) === String(s.shiftTypeId || s.shift_type_id));
      const basePoints = type?.points_base ? Number(type.points_base) : 1.0;

      let current = new Date(`${s.originalStart.split('T')[0]}T00:00:00`);
      let end = new Date(`${s.originalEnd.split('T')[0]}T23:59:59`);
      let totalDaysInShift = Math.round((end - current) / (1000 * 60 * 60 * 24)) + 1;
      let dayIndex = 0;
      let shiftPoints = 0;

      while (current <= end) {
        let dailyValue = basePoints;

        if (type && type.name.includes('שמירות')) {
          if (dayIndex === 0 || dayIndex === totalDaysInShift - 1) {
            dailyValue = 0.5 * basePoints;
          }
        } else if (type && type.name.includes('מטבח')) {
          if ((!s.isWeekend && current.getDay() === 4) || (s.isWeekend && current.getDay() === 1)) {
            dailyValue = 0.5 * basePoints;
          }
        }

        shiftPoints += dailyValue;
        current.setDate(current.getDate() + 1);
        dayIndex++;
      }

      const originalShiftId = s.id ? s.id.toString().split('-')[0] : null;
      const relevantExemptions = exemptions.filter(ex =>
        ex.shift_id && originalShiftId && String(ex.shift_id) === String(originalShiftId) && (ex.type === 'pet' || ex.type === 'squadron')
      );

      if (relevantExemptions.length > 0) {
        let currentCheck = new Date(`${s.originalStart.split('T')[0]}T00:00:00`);
        let checkEnd = new Date(`${s.originalEnd.split('T')[0]}T23:59:59`);
        let daysToSubtract = 0;
        let dayIdx = 0;

        while (currentCheck <= checkEnd) {
          const isCovered = relevantExemptions.some(ex => {
            const exStart = new Date(`${ex.start_date.split('T')[0]}T00:00:00`);
            const exEnd = new Date(`${ex.end_date.split('T')[0]}T23:59:59`);
            return currentCheck >= exStart && currentCheck <= exEnd;
          });

          if (isCovered) {
            let dailyValue = basePoints;
            if (type && type.name.includes('שמירות')) {
              if (dayIdx === 0 || dayIdx === totalDaysInShift - 1) {
                dailyValue = 0.5 * basePoints;
              }
            } else if (type && type.name.includes('מטבח')) {
              const dayOfWeek = currentCheck.getDay();
              if ((!s.isWeekend && dayOfWeek === 4) || (s.isWeekend && dayOfWeek === 1)) {
                dailyValue = 0.5 * basePoints;
              }
            }
            daysToSubtract += dailyValue;
          }

          currentCheck.setDate(currentCheck.getDate() + 1);
          dayIdx++;
        }

        shiftPoints = Math.max(0, shiftPoints - daysToSubtract);
      }

      totalPoints += shiftPoints;
    });

    return Number(totalPoints.toFixed(2));
  }

  const totalPotential = users
    .filter(u => u.is_active === 1 && u.does_shifts === 1)
    .reduce((sum, u) => sum + (u.potential_reduction || 100), 0);

  const totalNetPointsInPeriod = calculateTotalPointsInPeriod(displayedPeriodShifts, shiftExemptions, shiftTypes);

  const soldierQuota = (selectedUserObj && totalPotential > 0)
    ? (selectedUserObj.potential_reduction / totalPotential) * totalNetPointsInPeriod
    : 0;

  const quota = soldierQuota > 0 ? soldierQuota : 1;

  const generateGradientString = (distribution, total) => {
    let acc = 0;
    return distribution
      .filter(st => st.count > 0)
      .map(st => {
        const percentage = (st.count / (total || 1)) * 100;
        const start = acc;
        acc += percentage;
        return `${st.color} ${start}% ${acc}%`;
      })
      .join(', ');
  };

  const getStatColor = (actual, target) => {
    const diff = actual - target;
    const absDiff = Math.abs(diff);

    if (absDiff >= 5) return 'red';
    if (absDiff >= 3) return 'orange';
    return 'green';
  };

  const handleAutoAssign = async () => {
    if (!window.confirm("⚠️ האם להפעיל שיבוץ אוטומטי? המערכת תמלא את כל התורנויות הריקות לפי אילוצים ופטורים.")) {
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/api/auto-assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: currentUser.organization_id })
      });

      const data = await response.json();

      if (data.success) {
        alert("השיבוץ הושלם בהצלחה! 🚀");
        fetchShifts();
        fetchUsers();
      } else {
        alert("שגיאה בשיבוץ: " + data.message);
      }
    } catch (error) {
      console.error("Auto assign error:", error);
      alert("לא ניתן היה לבצע שיבוץ אוטומטי, אנא בדקי את השרת.");
    }
  };

  const fetchDivisions = () => {
    try {
      const uniqueDivisions = [...new Set(
        users
          .map(u => u.division)
          .filter(div => div && div !== "לא מוגדר" && div !== "undefined")
      )];
      setAvailableDivisions(uniqueDivisions);
    } catch (err) {
      console.error("שגיאה בחילוץ גפים:", err);
    }
  };

  const getNetStats = (userId, periodShiftsList, typesList) => {
    if (!periodShiftsList || !Array.isArray(periodShiftsList)) {
      return {
        netPoints: 0,
        netShabbats: 0,
        shabbatExemptionPoints: 0,
        shosh: 0,
        mkutzarot: 0,
        shushCount: 0,
        mkuzeretCount: 0
      };
    }

    let netPoints = 0;
    let netShabbats = 0;
    let shabbatExemptionPoints = 0;
    let shosh = 0;
    let mkutzarot = 0;

    const userShifts = periodShiftsList.filter(s => String(s.userId) === String(userId));

    userShifts.forEach(s => {
      const type = typesList ? typesList.find(t => String(t.id) === String(s.shiftTypeId)) : null;
      const typeName = type?.name || "";

      const startDate = new Date(s.originalStart.includes('T') ? s.originalStart : `${s.originalStart}T00:00:00`);
      const endDate = new Date(s.originalEnd.includes('T') ? s.originalEnd : `${s.originalEnd}T23:59:59`);
      const startDay = startDate.getDay();
      const endDay = endDate.getDay();

      const originalShiftId = s.id ? s.id.toString().split('-')[0] : null;
      const relevantExemptions = shiftExemptions.filter(ex =>
        ex.shift_id && originalShiftId && String(ex.shift_id) === String(originalShiftId)
      );

      const petWeekendExemption = relevantExemptions.find(ex => {
        if (ex.type !== 'pet') return false;
        const exStart = new Date(ex.start_date.includes('T') ? ex.start_date : `${ex.start_date}T00:00:00`);
        const exEnd = new Date(ex.end_date.includes('T') ? ex.end_date : `${ex.end_date}T23:59:59`);

        let d = new Date(exStart);
        while (d <= exEnd) {
          if (d.getDay() === 6) return true;
          d.setDate(d.getDate() + 1);
        }
        return false;
      });

      if (petWeekendExemption) {
        const petStart = new Date(petWeekendExemption.start_date.includes('T') ? petWeekendExemption.start_date : `${petWeekendExemption.start_date}T00:00:00`);
        const petEnd = new Date(petWeekendExemption.end_date.includes('T') ? petWeekendExemption.end_date : `${petWeekendExemption.end_date}T23:59:59`);
        const petStartDay = petStart.getDay();
        const petEndDay = petEnd.getDay();

        if (petStartDay === 5) shosh += 1;
        if (petEndDay === 6 || (endDay !== 6 && endDay >= 0)) mkutzarot += 1;
      } else {
        if (startDay === 0) mkutzarot += 1;
        if (endDay === 5) shosh += 1;
      }

      let current = new Date(startDate);
      const totalDaysInShift = Math.round((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
      let dayIndex = 0;
      let shiftPointsAccumulator = 0;

      while (current <= endDate) {
        const isShabbat = current.getDay() === 6;
        const dayOfWeek = current.getDay();

        const hasExemption = relevantExemptions.some(ex => {
          const exStart = new Date(ex.start_date.includes('T') ? ex.start_date : `${ex.start_date}T00:00:00`);
          const exEnd = new Date(ex.end_date.includes('T') ? ex.end_date : `${ex.end_date}T23:59:59`);
          return current >= exStart && current <= exEnd;
        });

        if (isShabbat) {
          if (hasExemption) {
            shabbatExemptionPoints += 1;
          } else {
            netShabbats += 1;
          }
        }

        let dailyPoints = Number(type?.points_base || 1.0);
        if (typeName.includes('שמירות')) {
          if (dayIndex === 0 || dayIndex === totalDaysInShift - 1) dailyPoints = 0.5;
        } else if (typeName.includes('מטבח')) {
          if ((!s.isWeekend && dayOfWeek === 4) || (s.isWeekend && dayOfWeek === 1)) {
            dailyPoints = 0.5;
          }
        }
        shiftPointsAccumulator += dailyPoints;

        current.setDate(current.getDate() + 1);
        dayIndex++;
      }

      if (relevantExemptions.length > 0) {
        let currentCheck = new Date(startDate);
        let daysToSubtract = 0;
        let dayIdx = 0;

        while (currentCheck <= endDate) {
          const isCovered = relevantExemptions.some(ex => {
            const exStart = new Date(ex.start_date.includes('T') ? ex.start_date : `${ex.start_date}T00:00:00`);
            const exEnd = new Date(ex.end_date.includes('T') ? ex.end_date : `${ex.end_date}T23:59:59`);
            return currentCheck >= exStart && currentCheck <= exEnd;
          });

          if (isCovered) {
            let dailyPoints = Number(type?.points_base || 1.0);
            if (typeName.includes('שמירות')) {
              if (dayIdx === 0 || dayIdx === totalDaysInShift - 1) dailyPoints = 0.5;
            } else if (typeName.includes('מטבח')) {
              const dayOfWeek = currentCheck.getDay();
              if ((!s.isWeekend && dayOfWeek === 4) || (s.isWeekend && dayOfWeek === 1)) {
                dailyPoints = 0.5;
              }
            }
            daysToSubtract += dailyPoints;
          }

          currentCheck.setDate(currentCheck.getDate() + 1);
          dayIdx++;
        }

        shiftPointsAccumulator = Math.max(0, shiftPointsAccumulator - daysToSubtract);
      }

      netPoints += shiftPointsAccumulator;
    });

    return {
      netPoints: Number(netPoints.toFixed(2)),
      netShabbats,
      shabbatExemptionPoints: Number(shabbatExemptionPoints.toFixed(2)),
      shosh,
      mkutzarot,
      shushCount: shosh,
      mkuzeretCount: mkutzarot
    };
  };

  const soldierStats = selectedUserObj
    ? getNetStats(selectedUserObj.id, displayedPeriodShifts, shiftTypes)
    : { netPoints: 0, netShabbats: 0, shabbatExemptionPoints: 0, shosh: 0, mkutzarot: 0 };

  const netPoints = soldierStats.netPoints;
  const netShabbats = soldierStats.netShabbats;

  const calculateShiftPoints = (shift, exemptions, typesList) => {
    const typeDetails = typesList.find(t => String(t.id) === String(shift.shift_type_id || shift.shiftTypeId));
    let points = typeDetails ? Number(typeDetails.points_base) : 1.0;

    const hasPetExemption = exemptions.some(ex =>
      String(ex.shift_id) === String(shift.id) && ex.type === 'pet'
    );

    if (hasPetExemption && shift.is_weekend) {
      points = Math.max(0, points - 1.0);
    }

    return points;
  };

  const handleTimeChange = (e, field) => {
    const time = e.target.value;
    if (!time) {
      setReplacementForm({ ...replacementForm, [field]: '' });
      return;
    }

    let [hours, minutes] = time.split(':').map(Number);
    const roundedMinutes = Math.round(minutes / 15) * 15;
    const finalMinutes = roundedMinutes % 60;
    const finalHours = roundedMinutes === 60 ? (hours + 1) % 24 : hours;

    const formattedTime = `${String(finalHours).padStart(2, '0')}:${String(finalMinutes).padStart(2, '0')}`;
    setReplacementForm({ ...replacementForm, [field]: formattedTime });
  };

  const dayPropGetter = (date) => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const compareDate = new Date(date);
    compareDate.setHours(0, 0, 0, 0);
    const dateStr = format(compareDate, 'yyyy-MM-dd');

    // בדיקה האם יש טווח תאריכים שנבחר כרגע (בחלון בחירה, שיבוץ או אילוץ)
    const activeStart =
      selectedSlotDates?.startDate ||
      (isModalOpen ? formData.startDate : null) ||
      (isConstraintModalOpen ? constraintFormData.startDate : null);

    const activeEnd =
      selectedSlotDates?.endDate ||
      (isModalOpen ? formData.endDate : null) ||
      (isConstraintModalOpen ? constraintFormData.endDate : null);

    // אם היום הזה נמצא בתוך טווח ההתחלה והסיום שנבחר - נצייר קו מחבר רציף בין הימים!
    if (activeStart && activeEnd && dateStr >= activeStart && dateStr <= activeEnd) {
      const isStart = dateStr === activeStart;
      const isEnd = dateStr === activeEnd;

      return {
        style: {
          backgroundColor: 'rgba(232, 176, 189, 0.45)', // רקע ורדרד עדין לטווח הנבחר
          backgroundImage: `linear-gradient(to bottom, transparent 46%, ${theme.darkgreen} 46%, ${theme.darkgreen} 54%, transparent 54%)`, // קו אמצעי מחבר בין הימים
          borderTop: `2px solid ${theme.darkgreen}`,
          borderBottom: `2px solid ${theme.darkgreen}`,
          borderRight: isStart ? `3px solid ${theme.darkgreen}` : 'none', // התחלה בימין (RTL)
          borderLeft: isEnd ? `3px solid ${theme.darkgreen}` : 'none',    // סיום בשמאל (RTL)
          fontWeight: 'bold'
        }
      };
    }

    // 1. האם זה היום?
    if (compareDate.getTime() === now.getTime()) {
      return {
        style: {
          backgroundColor: theme.pink,
          fontWeight: 'bold'
        }
      };
    }

    // 2. האם זה יום שעבר?
    if (compareDate < now) {
      return {
        style: {
          backgroundColor: '#e0e0e0',
          opacity: 0.7
        }
      };
    }

    return {};
  };

  const getProgressColor = (performed, targetQuota) => {
    if (targetQuota <= 0) return '#28a745';
    const percentage = (performed / targetQuota) * 100;

    if (percentage < 50) return '#dc3545';
    if (percentage < 85) return '#ffc107';
    return '#28a745';
  };

  const barColor = getProgressColor(netPoints, quota);

  const getComparisonStats = (usersList, shiftsList, exemptions, typesList) => {
    const holidayNames = ["ראש השנה", "יום כיפור", "סוכות", "פסח א'", "פסח ב'", "שבועות"];

    return usersList.map(user => {
      const userShifts = shiftsList.filter(s => String(s.userId) === String(user.id));
      let statsObj = {
        name: user.full_name,
        totalPoints: 0,
        shabbats: 0,
        blatams: 0,
        holidays: {},
        shiftCounts: {}
      };

      userShifts.forEach(s => {
        if (exemptions.some(ex => String(ex.shift_id) === String(s.id))) return;

        const type = typesList.find(t => String(t.id) === String(s.shiftTypeId));
        const typeName = type ? type.name : "לא ידוע";
        statsObj.shiftCounts[typeName] = (statsObj.shiftCounts[typeName] || 0) + 1;

        if (s.isWeekend) statsObj.shabbats += 1;
        if (s.isBaltam) statsObj.blatams += 1;

        if (s.holidayName) {
          s.holidayName.split(', ').forEach(h => {
            if (holidayNames.includes(h)) {
              statsObj.holidays[h] = (statsObj.holidays[h] || 0) + 1;
            }
          });
        }

        statsObj.totalPoints += calculateShiftPoints(s, exemptions, typesList);
      });
      return statsObj;
    });
  };

  const stats = useMemo(() => {
    return getComparisonStats(users, shifts, shiftExemptions, shiftTypes);
  }, [users, shifts, shiftExemptions, shiftTypes]);

  const progressPercentage = Math.min((netPoints / quota) * 100, 100);

  const start = selectedSlotDates?.startDate;
  const end = selectedSlotDates?.endDate;
  const hasShabbat = doesRangeContainShabbat(start, end);

  const savePeriodsToServer = (updatedPeriods) => {
    setCustomPeriods(updatedPeriods);
    if (!currentUser || !currentUser.organization_id) return;

    fetch(`${API_BASE}/api/periods`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        organization_id: currentUser.organization_id,
        periods: updatedPeriods.map(p => ({
          name: p.name,
          start_date: p.startDate,
          end_date: p.endDate
        }))
      })
    })
      .then(res => res.json())
      .then(() => alert("התקופות נשמרו בשרת בהצלחה! 💾"))
      .catch(err => console.error("שגיאה בשמירת תקופות:", err));
  };

  const iconButtonStyle = {
    flex: 1,
    padding: '12px',
    backgroundColor: theme.pink,
    color: theme.darkgreen,
    border: `1px solid ${theme.darkgreen}`,
    borderRadius: '12px',
    cursor: 'pointer',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center'
  };

  if (!currentUser) {
    return (
      <div style={{
        height: '100vh',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        background: `${theme.backgroundcolor}`,
        fontFamily: 'sans-serif',
        direction: 'rtl'
      }}>
        <form onSubmit={handleLogin} style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          width: '100%',
          maxWidth: '400px',
          padding: '20px'
        }}>
          <h1 style={{
            color: `${theme.darkgreen}`,
            fontSize: '2.5rem',
            fontWeight: '700',
            textAlign: 'center',
            margin: '0 0 25px 0'
          }}>ברוכים הבאים למערכת תורנויות</h1>
          <h2 style={{
            background: `${theme.pink}`,
            padding: '8px 20px',
            borderRadius: '8px',
            color: `${theme.darkgreen}`,
            marginBottom: '40px',
            fontWeight: '700',
            fontSize: '2rem',
            textAlign: 'center',
            display: 'inline-block'
          }}>תורנויHOT</h2>

          <div style={{ width: '100%', marginBottom: '20px' }}>
            <label style={{ display: 'block', marginBottom: '8px', color: `${theme.darkgreen}`, fontWeight: 'bold' }}>שם משתמש</label>
            <input
              type="text"
              value={loginName}
              onChange={(e) => setLoginName(e.target.value)}
              placeholder="שם משתמש"
              style={{
                width: '100%',
                padding: '15px',
                borderRadius: '15px',
                border: `2px solid ${theme.darkgreen}`,
                boxSizing: 'border-box'
              }}
            />
          </div>

          <div style={{ width: '100%', marginBottom: '30px', position: 'relative' }}>
            <label style={{ display: 'block', marginBottom: '8px', color: `${theme.darkgreen}`, fontWeight: 'bold' }}>
              סיסמה
            </label>

            <input
              type={showPassword ? "text" : "password"}
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              placeholder="סיסמה"
              style={{
                width: '100%',
                padding: '15px',
                borderRadius: '15px',
                border: `2px solid ${theme.darkgreen}`,
                boxSizing: 'border-box'
              }}
            />

            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              style={{
                position: 'absolute',
                left: '15px',
                top: '47px',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: theme.darkgreen,
                display: 'flex',
                alignItems: 'center'
              }}
            >
              {showPassword ? <FiEyeOff size={20} /> : <FiEye size={20} />}
            </button>
          </div>

          <button type="submit" style={{
            padding: '15px 50px',
            background: `${theme.pink}`,
            color: `${theme.darkgreen}`,
            border: `2px solid ${theme.darkgreen}`,
            borderRadius: '15px',
            cursor: 'pointer',
            fontWeight: 'bold',
            marginTop: '20px',
            fontSize: '25px'
          }}>כניסה</button>
        </form>
      </div>
    );
  }

  if (shifts === null || users === null) {
    return <div>טוען נתונים...</div>;
  }

  if (currentUser.role === 'super_admin') {
    return (
      <div style={{
        padding: '40px',
        backgroundColor: theme.backgroundcolor,
        minHeight: '100vh',
        color: theme.darkgreen,
        direction: 'rtl',
        fontStyle: 'normal'
      }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '20px' }}>
          <button onClick={handleLogout} style={{
            background: `${theme.pink}`,
            color: `${theme.darkgreen}`,
            border: `2px solid ${theme.darkgreen}`,
            borderRadius: '15px',
            cursor: 'pointer',
            fontWeight: 'bold',
            fontSize: '20px',
            padding: '10px 25px'
          }}>התנתק</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '30px' }}>
          <section style={{ background: `${theme.backgroundcolor}`, padding: '25px', borderRadius: '15px', border: `2px solid ${theme.darkgreen}`, minHeight: '500px' }}>
            <h2 style={{ color: theme.darkgreen, fontSize: '2rem', fontStyle: 'normal' }}>ליצירת טייסת חדשה:</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', marginTop: '20px' }}>
              <input type="text" placeholder="שם הטייסת" value={squadronName} onChange={(e) => setSquadronName(e.target.value)} style={{ padding: '10px', borderRadius: '5px', border: `1px solid ${theme.lightgreen}`, backgroundColor: `${theme.backgroundcolor}` }} />
              <input type="text" placeholder="שם מלא של האחראי" value={adminName} onChange={(e) => setAdminName(e.target.value)} style={{ padding: '10px', borderRadius: '5px', border: `1px solid ${theme.lightgreen}`, backgroundColor: `${theme.backgroundcolor}` }} />
              <input type="password" placeholder="סיסמה" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} style={{ padding: '10px', borderRadius: '5px', border: `1px solid ${theme.lightgreen}`, backgroundColor: `${theme.backgroundcolor}` }} />
            </div>
            <button onClick={handleCreateSquadronAndAdmin} style={{
              width: "120px",
              height: "55px",
              background: `${theme.pink}`,
              color: `${theme.darkgreen}`,
              border: `2px solid ${theme.darkgreen}`,
              borderRadius: '15px',
              cursor: 'pointer',
              fontWeight: 'bold',
              marginTop: '20px',
              fontSize: '22px',
            }}>יצירה</button>
          </section>

          <section style={{ background: `${theme.backgroundcolor}`, padding: '25px', borderRadius: '15px', border: `2px solid ${theme.darkgreen}` }}>
            <h2 style={{ color: theme.darkgreen, fontSize: '2rem', marginBottom: "25px" }}>רשימת טייסות קיימות</h2>
            <input type="text" placeholder="חיפוש טייסת..." onChange={(e) => setSearchTerm(e.target.value)} style={{ width: '100%', padding: '10px', marginBottom: '15px', borderRadius: '10px', border: `2px solid ${theme.lightgreen}`, backgroundColor: `${theme.backgroundcolor}`, boxSizing: 'border-box' }} />

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {squadrons.filter(s => (s.name || '').toLowerCase().includes(searchTerm.toLowerCase())).map(s => (
                <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px', background: `${theme.backgroundcolor}`, borderRadius: '15px', border: `2px solid ${theme.darkgreen}`, alignItems: 'center' }}>
                  <div style={{ textAlign: "right" }}>
                    <span style={{ fontWeight: 'bold', display: 'block', fontSize: "25px", textAlign: "right" }}>{s.name}</span>
                    <span style={{ fontSize: '18px', color: theme.lightgreen, textAlign: "right" }}>אחראי: {s.admin_name || 'לא הוגדר'}</span>
                  </div>
                  <button onClick={() => openSquadronManagement(s)} style={{ background: theme.pink, color: theme.darkgreen, border: 'none', padding: '8px 12px', borderRadius: '5px', cursor: 'pointer', fontSize: "15px", fontWeight: '700' }}>לפרטים</button>
                </div>
              ))}
            </div>
          </section>
        </div>

        {managingSquadron && (
          <div style={{ position: 'fixed', top: '5%', left: '5%', width: '90%', height: '90vh', background: `${theme.backgroundcolor}`, border: `2px solid ${theme.darkgreen}`, padding: '30px', borderRadius: '15px', overflowY: 'auto', zIndex: 1000, boxSizing: 'border-box' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ color: `${theme.darkgreen}` }}>{managingSquadron.name}</h2>
              <button onClick={() => setManagingSquadron(null)} style={{ padding: '8px 16px', background: `${theme.backgroundcolor}`, color: `${theme.darkgreen}`, borderRadius: '5px', cursor: "pointer", border: `1px solid ${theme.darkgreen}` }}>סגור</button>
            </div>

            <section style={{ marginTop: '20px' }}>
              <h3>חיילי הטייסת</h3>

              {squadronUsers.map(u => (
                <div key={u.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '15px', borderBottom: `1px solid ${theme.darkgreen}` }}>
                  <div style={{ fontSize: '16px', fontWeight: '500' }}>
                    {u.full_name}
                    {u.role === 'admin' && <span style={{ marginRight: '8px' }}> (אחראי תורנויות)</span>}
                  </div>

                  <div style={{ display: 'flex', gap: '10px' }}>
                    {u.role !== 'admin' && (
                      <button onClick={() => updateAdmin(u.id)} style={{ background: theme.backgroundcolor, color: theme.darkgreen, border: `1px solid ${theme.darkgreen}`, padding: '6px 12px', borderRadius: '6px', cursor: 'pointer' }}>
                        הפוך לאחראי
                      </button>
                    )}
                    <button onClick={() => deleteUser(u.id)} style={{ background: '#fff5f5', color: '#dc3545', border: '1px solid #dc3545', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer' }}>
                      מחק
                    </button>
                  </div>
                </div>
              ))}
            </section>

            <section style={{ marginTop: '30px' }}>
              <h3>תקלות ודיווחים</h3>
              <div style={{ background: `${theme.backgroundcolor}`, padding: '15px', borderRadius: '8px' }}>
                <p>אין תקלות פעילות כרגע.</p>
              </div>
            </section>

            <div style={{ marginTop: '40px', borderTop: '2px solid #eee', paddingTop: '20px' }}>
              <button onClick={() => deleteSquadron(managingSquadron.id)} style={{ background: '#dc3545', color: 'white', padding: '10px 20px', border: 'none', borderRadius: '5px', cursor: 'pointer' }}>מחק טייסת לצמיתות</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex',
      height: '100vh',
      backgroundColor: theme.backgroundcolor,
      color: theme.darkgreen,
      fontFamily: "'Rubik', sans-serif",
      direction: 'rtl'
    }}>

      {/* תפריט הצד */}
      <div style={{
        width: '280px',
        backgroundColor: theme.backgroundcolor,
        border: `2px solid ${theme.darkgreen}`,
        height: "96.5%",
        borderRadius: "30px",
        marginTop: "15px",
        marginRight: "15px",
        padding: '20px',
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
        boxSizing: 'border-box'
      }}>
        <div style={{ paddingBottom: '10px', marginBottom: '0px' }}>
          <h2 style={{ margin: 0, color: theme.darkgreen }}>טייסת חופ"ה</h2>
          <span style={{ fontSize: '16px', color: theme.darkgreen }}>שלום, {currentUser.full_name}</span>
        </div>

        <ul style={{ listStyle: 'none', padding: 0, flex: 1, overflowY: 'auto' }}>
          {users
            .filter(user => user.is_active === 1 && user.does_shifts === 1)
            .map(user => {
              const isSelected = selectedUserId === user.id;
              const performedBE = getNetStats(user.id, displayedPeriodShifts, shiftTypes);
              const performed = performedBE.netPoints;
              const userQuota = totalPotential > 0 ? ((user.potential_reduction || 100) / totalPotential) * totalNetPointsInPeriod : 0;
              const statusColor = getStatColor(performed, userQuota);

              return (
                <li
                  key={user.id}
                  onClick={() => {
                    setIsPanelOpen(true);
                    if (selectedUserId === user.id) {
                      setSelectedUserId(null);
                    } else {
                      setSelectedUserId(user.id);
                      setSelectedPeriod("2026-07");
                      setIsPanelOpen(true);
                    }
                  }}
                  style={{
                    padding: '12px',
                    background: isSelected ? theme.pink : 'transparent',
                    color: theme.darkgreen,
                    marginBottom: '8px',
                    borderRadius: '12px',
                    cursor: 'pointer',
                    border: `1px solid ${theme.lightgreen}`,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}
                >
                  <span>{user.full_name} {user.role === 'admin' ? '(אחראי)' : ''}</span>
                  <span style={{
                    fontWeight: 'bold',
                    color: statusColor,
                    background: "transparent",
                    padding: '2px 8px',
                    borderRadius: '10px',
                    fontSize: '15px'
                  }}>
                    {performed}
                  </span>
                </li>
              );
            })}
        </ul>

        {currentUser.role === 'admin' && (
          <div style={{ display: 'flex', gap: '25px', marginTop: 'auto', paddingTop: '20px' }}>
            <button onClick={() => setIsSettingsOpen(true)} style={iconButtonStyle}>
              <FiSettings size={30} />
            </button>

            <button onClick={() => setIsPublishChoiceOpen(true)} style={iconButtonStyle}>
              <FiUpload size={30} />
            </button>

            <button onClick={() => setSelectedSlotDates({ startDate: format(new Date(), 'yyyy-MM-dd'), endDate: format(new Date(), 'yyyy-MM-dd') })} style={iconButtonStyle}>
              <FiPlus size={30} />
            </button>
          </div>
        )}
      </div>

      {/* אזור הלוח המרכזי */}
      <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', padding: '20px', overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            {currentUser.role === 'admin' && (
              <button
                onClick={handleAutoAssign}
                style={{
                  padding: '8px 16px',
                  background: theme.pink,
                  color: theme.darkgreen,
                  border: `2px solid ${theme.darkgreen}`,
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: "bold"
                }}
              >
                שבץ אוטומטית
              </button>
            )}

            {currentUser.role === 'soldier' && (
              <button
                onClick={handleConnectCalendar}
                style={{
                  padding: '8px 14px',
                  background: theme.pink,
                  color: theme.darkgreen,
                  border: `2px solid ${theme.darkgreen}`,
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontSize: '13px',
                  fontWeight: "bold"
                }}
              >
                סנכרן ליומן גוגל
              </button>
            )}
          </div>

          {currentUser.role === 'admin' && (
            <div style={{ display: 'flex', gap: '10px', background: theme.lightgreen, padding: '5px', width: '350px', borderRadius: '30px', border: `1px solid ${theme.darkgreen}` }}>
              <button onClick={() => setViewMode('calendar')} style={{ flex: 1, padding: '8px', background: viewMode === 'calendar' ? theme.pink : 'transparent', color: viewMode === 'calendar' ? theme.darkgreen : theme.backgroundcolor, border: 'none', borderRadius: '20px', cursor: 'pointer', fontSize: '18px', fontWeight: 'bold' }}>לוח שנה</button>
              <button onClick={() => setViewMode('table')} style={{ flex: 1, padding: '8px', background: viewMode === 'table' ? theme.pink : 'transparent', color: viewMode === 'table' ? theme.darkgreen : theme.backgroundcolor, border: 'none', borderRadius: '20px', cursor: 'pointer', fontSize: '18px', fontWeight: 'bold' }}>סיכום תקופתי</button>
            </div>
          )}

          <button
            onClick={handleLogout}
            style={{
              padding: '8px 16px',
              background: theme.pink,
              color: theme.darkgreen,
              border: `1px solid ${theme.darkgreen}`,
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 'bold'
            }}
          >
            התנתק
          </button>
        </div>

        <div style={{ flex: 1, background: theme.backgroundcolor, padding: '20px', borderRadius: '25px', border: `3px solid ${theme.lightgreen}`, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {viewMode === 'calendar' || currentUser.role !== 'admin' ? (
            <Calendar
              localizer={localizer}
              events={allCalendarEvents}
              startAccessor="start"
              endAccessor="end"
              culture="he"
              dayPropGetter={dayPropGetter}
              rtl={true}
              eventPropGetter={eventStyleGetter}
              onSelectEvent={handleEventClick}
              date={currentDate}
              onNavigate={(newDate) => setCurrentDate(newDate)}
              selectable={currentUser.role === 'admin'}
              onSelectSlot={currentUser.role === 'admin' ? handleSelectSlot : undefined}
              components={{ toolbar: (props) => <CustomToolbar {...props} theme={theme} currentUser={currentUser} /> }}
              style={{ flex: 1, backgroundColor: theme.backgroundcolor, color: theme.darkgreen }}
              popup={true}
              messages={{
                showMore: (total) => `+ עוד ${total}`
              }}
            />
          ) : (
            <div style={{
              background: theme.backgroundcolor, padding: '20px', borderRadius: '12px', flex: 1, maxHeight: '75vh', direction: "ltr", overflowY: 'auto'
            }}>
              <div style={{ direction: "rtl" }}>
                <h2 style={{ direction: "rtl", color: theme.darkgreen, marginTop: 0, marginBottom: '20px', borderBottom: `2px solid ${theme.lightgreen}`, paddingBottom: '10px' }}>
                  סיכום הקצאה תקופתית (לפי תאריך התחלה)
                </h2>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'center', borderRadius: '30px' }}>
                    <thead>
                      <tr style={{ background: theme.backgroundcolor, borderRadius: '30px', borderBottom: `2px solid ${theme.lightgreen}` }}>
                        <th style={{ padding: '15px', borderBottom: `2px solid ${theme.lightgreen}`, border: `1px solid ${theme.lightgreen}`, color: theme.darkgreen }}>שבוע (ב' - א')</th>
                        {shiftTypes.map(type => (
                          <th key={type.id} style={{ padding: '15px', borderBottom: `2px solid ${theme.lightgreen}`, border: `1px solid ${theme.lightgreen}`, color: type.color ? (type.color.startsWith('#') ? type.color : `#${type.color}`) : theme.darkgreen }}>
                            {type.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sortedWeeks.map(week => (
                        <tr key={week} style={{ borderBottom: `1px solid ${theme.lightgreen}` }}>
                          <td style={{ padding: '12px', border: `1px solid ${theme.lightgreen}`, fontWeight: 'bold', backgroundColor: theme.backgroundcolor, color: theme.darkgreen }}>{week}</td>
                          {shiftTypes.map(type => {
                            const count = weeklySummary[week][type.id]?.size || 0;
                            return (
                              <td key={type.id} style={{
                                padding: '12px',
                                border: `1px solid ${theme.lightgreen}`,
                                fontSize: '18px',
                                color: count === 0 ? '#ccc' : theme.darkgreen,
                                fontWeight: count === 0 ? 'normal' : 'bold',
                                backgroundColor: count === 0 ? theme.backgroundcolor : '#f0fff4'
                              }}>
                                {count}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                      {sortedWeeks.length === 0 && (
                        <tr>
                          <td colSpan={shiftTypes.length + 1} style={{ padding: '30px', color: theme.darkgreen, fontSize: '16px' }}>
                            אין הקצאות בלוח בתקופה זו.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* חלונית סטטיסטיקה צפה */}
      {currentUser.role === "admin" && isPanelOpen && (
        <Draggable nodeRef={nodeRef}>
          <div ref={nodeRef} style={{
            position: 'absolute', left: '30px', top: '120px', width: '240px',
            backgroundColor: theme.pink, height: 'auto', maxHeight: 'calc(100vh - 180px)', overflowY: 'auto', borderRadius: '20px',
            padding: '20px', zIndex: 10, color: theme.darkgreen, display: 'flex',
            flexDirection: 'column', gap: '15px', border: `2px solid ${theme.darkgreen}`
          }}>
            <button onClick={() => { setIsPanelOpen(false); setSelectedUserId(null); }} style={{ position: 'absolute', top: '10px', left: '10px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px', color: theme.darkgreen }}>✖</button>

            {!selectedUserId || !selectedUserObj ? (
              <div style={{ padding: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                  <button onClick={handlePrevStatsPeriod} style={{ padding: '8px 5px', background: "transparent", color: theme.darkgreen, border: "none", position: "relative", bottom: "2px", borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: "20px" }}>▶</button>
                  <h3 style={{ margin: 0 }}>תקופה {displayedPeriodStr}</h3>
                  <button onClick={handleNextStatsPeriod} style={{ padding: '8px 5px', background: "transparent", color: theme.darkgreen, border: "none", position: "relative", bottom: "2px", borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: "20px" }}>◀</button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '15px' }}>
                  <div style={{ background: 'rgba(255,255,255,0.4)', padding: '10px', borderRadius: '10px', textAlign: 'center' }}>
                    <div style={{ fontSize: '18px', fontWeight: 'bold' }}>{benchmarkQuota.toFixed(1)}</div>
                    <div style={{ fontSize: '10px' }}>ממוצע לחייל בתקופה 100%</div>
                  </div>
                  <div style={{ background: 'rgba(255,255,255,0.4)', padding: '10px', borderRadius: '10px', textAlign: 'center' }}>
                    <div style={{ fontSize: '18px', fontWeight: 'bold' }}>{(benchmarkQuota / 6).toFixed(1)}</div>
                    <div style={{ fontSize: '10px' }}>ממוצע לחודש</div>
                  </div>
                </div>

                <div style={{ marginTop: '20px', textAlign: 'center' }}>
                  <div style={{ fontSize: '12px', marginBottom: '10px', color: theme.darkgreen }}>התפלגות תורנויות:</div>

                  <div style={{
                    width: '100px',
                    height: '100px',
                    borderRadius: '50%',
                    margin: '0 auto',
                    background: shiftTypeDistribution.some(st => st.count > 0)
                      ? `conic-gradient(${generateGradientString(shiftTypeDistribution, totalShiftsInPeriod)})`
                      : '#ccc'
                  }} />

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '15px', justifyContent: 'center' }}>
                    {shiftTypeDistribution.map((st, i) => (
                      <div key={i} style={{ fontSize: '10px', display: 'flex', alignItems: 'center', gap: '3px' }}>
                        <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: st.color }} />
                        {st.name} ({st.count})
                      </div>
                    ))}
                  </div>
                  <div>
                    {currentScreen === 'calendar' && (
                      <button onClick={() => setCurrentScreen('dashboard')} style={{ padding: '8px 16px', background: theme.pink, color: theme.darkgreen, border: `1px solid ${theme.darkgreen}`, borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', transition: 'background 0.2s', marginTop: "15px" }}>
                        מעבר לדוח השוואה
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div>
                <h3 style={{ margin: 0, textAlign: 'center' }}>{selectedUserObj.full_name}</h3>
                <div style={{ margin: '15px 0', textAlign: 'center' }}>
                  <label style={{ fontSize: '13px', fontWeight: 'bold' }}>בחר תקופה להצגה: </label>
                  <select
                    value={displayedPeriodStr}
                    onChange={(e) => {
                      const selectedPeriodName = e.target.value;
                      const found = customPeriods.find(p => p.name === selectedPeriodName);
                      if (found && found.startDate) {
                        setStatsDate(new Date(found.startDate + 'T00:00:00'));
                      }
                    }}
                    style={{ padding: '5px', marginRight: "7px", borderRadius: '8px', border: `1px solid ${theme.darkgreen}`, backgroundColor: theme.pink }}
                  >
                    {customPeriods.map(period => (
                      <option key={period.name} value={period.name}>תקופה {period.name}</option>
                    ))}
                  </select>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <div style={{ textAlign: 'center', background: 'rgba(255,255,255,0.4)', padding: '10px', borderRadius: '10px' }}>
                    <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{netPoints}</div>
                    <div style={{ fontSize: '12px' }}>ימי תורנות</div>
                  </div>
                  <div style={{ textAlign: 'center', background: 'rgba(255,255,255,0.4)', padding: '10px', borderRadius: '10px' }}>
                    <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{netShabbats}</div>
                    <div style={{ fontSize: '12px' }}>שבתות</div>
                  </div>
                  <div style={{ textAlign: 'center', background: 'rgba(255,255,255,0.4)', padding: '10px', borderRadius: '10px' }}>
                    <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{soldierStats.shosh}</div>
                    <div style={{ fontSize: '12px' }}>שושים</div>
                  </div>
                  <div style={{ textAlign: 'center', background: 'rgba(255,255,255,0.4)', padding: '10px', borderRadius: '10px' }}>
                    <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{soldierStats.mkutzarot}</div>
                    <div style={{ fontSize: '12px' }}>מקוצרות</div>
                  </div>
                  <div style={{ textAlign: 'center', background: 'rgba(255,255,255,0.4)', padding: '10px', borderRadius: '10px' }}>
                    <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{displayedPeriodShifts.filter(s => String(s.userId || '') === String(selectedUserId || '') && s.isBaltam).length}</div>
                    <div style={{ fontSize: '12px' }}>בלת"מים</div>
                  </div>
                  <div style={{ textAlign: 'center', background: 'rgba(255,255,255,0.4)', padding: '10px', borderRadius: '10px' }}>
                    <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{constraints.filter(c => String(c.userId) === String(selectedUserId)).length}</div>
                    <div style={{ fontSize: '12px' }}>ימי אילוץ</div>
                  </div>
                </div>

                <div style={{ background: 'rgba(255,255,255,0.3)', padding: '10px', borderRadius: '10px', marginTop: '15px' }}>
                  <div style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '5px' }}>פטורים:</div>
                  {selectedUserObj.exemptionIds && selectedUserObj.exemptionIds.length > 0 ? (
                    <div style={{ fontSize: '13px' }}>
                      {selectedUserObj.exemptionIds.map(id => {
                        const ex = exemptionTypes.find(e => String(e.id) === String(id));
                        return <div key={id}>{ex ? ex.name : ''}</div>;
                      })}
                    </div>
                  ) : <div style={{ fontSize: '13px' }}>אין פטורים</div>}
                </div>

                <div style={{ marginTop: '15px' }}>
                  <div style={{ fontSize: '14px', fontWeight: 'bold' }}>תאריך שחרור:</div>
                  <div style={{ fontSize: '14px' }}>{formatDateHe(selectedUserObj.release_date)}</div>
                </div>

                <div style={{ marginTop: '20px', padding: '15px', background: 'rgba(255,255,255,0.3)', borderRadius: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '8px', fontWeight: 'bold' }}>
                    <span>ניצול מכסה:</span>
                    <span>{netPoints} מתוך {quota.toFixed(1)}</span>
                  </div>

                  <div style={{ background: '#fff', color: barColor, height: '12px', borderRadius: '6px', overflow: 'hidden', border: '1px solid #ddd' }}>
                    <div style={{
                      width: `${progressPercentage}%`,
                      background: barColor,
                      height: '100%',
                      transition: 'width 0.6s cubic-bezier(0.22, 1, 0.36, 1)'
                    }} />
                  </div>

                  <div style={{ fontSize: '10px', marginTop: '5px', color: '#666', textAlign: 'right' }}>
                    {progressPercentage.toFixed(0)}% הושלם
                  </div>
                </div>
              </div>
            )}
          </div>
        </Draggable>
      )}

      {/* חלון פרסום תורנויות */}
      {isPublishModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(58, 33, 25, 0.6)', zIndex: 3000, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <div style={{ background: theme.backgroundcolor, padding: '30px', borderRadius: '10px', width: '400px', position: 'relative' }}>
            <button
              onClick={() => { setIsPublishModalOpen(false); setPublishFormData({ startDate: '', endDate: '' }); }}
              style={{ position: 'absolute', top: '10px', left: '10px', background: 'transparent', border: 'none', fontSize: '20px', cursor: 'pointer', color: theme.darkgreen }}>✖</button>
            <h2 style={{ marginTop: 0, paddingBottom: '10px', color: theme.darkgreen }}>פרסום טווח תורנויות</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', marginTop: '20px', color: theme.darkgreen }}>
              <div><label>מאיזה תאריך:</label><input type="date" value={publishFormData.startDate} onChange={(e) => handleDateSelection('publish', 'startDate', e.target.value)} style={{ width: '100%', padding: '8px', boxSizing: 'border-box', borderRadius: "15px", backgroundColor: theme.backgroundcolor, border: `1px solid ${theme.darkgreen}`, color: theme.darkgreen }} /></div>
              <div><label>עד איזה תאריך:</label><input type="date" value={publishFormData.endDate} onChange={(e) => handleDateSelection('publish', 'endDate', e.target.value)} style={{ width: '100%', padding: '8px', boxSizing: 'border-box', borderRadius: "15px", backgroundColor: theme.backgroundcolor, border: `1px solid ${theme.darkgreen}`, color: theme.darkgreen }} /></div>
              <button onClick={handlePublishBoard} style={{ padding: '12px', background: theme.pink, color: theme.darkgreen, border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold', fontSize: '15px' }}>פרסם לחיילים</button>
            </div>
          </div>
        </div>
      )}

      {/* חלון ביטול פרסום */}
      {isUnpublishModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(58, 33, 25, 0.6)', zIndex: 3000, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <div style={{ background: theme.backgroundcolor, padding: '30px', borderRadius: '10px', width: '400px', position: 'relative' }}>
            <button
              onClick={() => { setIsUnpublishModalOpen(false); setUnpublishFormData({ startDate: '', endDate: '' }); }}
              style={{ position: 'absolute', top: '10px', left: '10px', background: 'transparent', border: 'none', fontSize: '20px', cursor: 'pointer', color: theme.darkgreen }}>✖</button>
            <h2 style={{ marginTop: 0, paddingBottom: '10px', color: theme.darkgreen }}>ביטול פרסום טווח</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', marginTop: '5px', color: theme.darkgreen }}>
              <div><label>מאיזה תאריך לבטל:</label><input type="date" value={unpublishFormData.startDate} onChange={(e) => handleDateSelection('unpublish', 'startDate', e.target.value)} style={{ width: '100%', padding: '8px', boxSizing: 'border-box', borderRadius: "15px", backgroundColor: theme.backgroundcolor, border: `1px solid ${theme.darkgreen}`, color: theme.darkgreen }} /></div>
              <div><label>עד איזה תאריך לבטל:</label><input type="date" value={unpublishFormData.endDate} onChange={(e) => handleDateSelection('unpublish', 'endDate', e.target.value)} style={{ width: '100%', padding: '8px', boxSizing: 'border-box', borderRadius: "15px", backgroundColor: theme.backgroundcolor, border: `1px solid ${theme.darkgreen}`, color: theme.darkgreen }} /></div>
              <button onClick={handleUnpublishBoard} style={{ marginTop: "15px", padding: '12px', background: theme.pink, color: theme.darkgreen, border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold', fontSize: '15px' }}>בטל פרסום והחזר לטיוטה</button>
            </div>
          </div>
        </div>
      )}

      {/* בחירה בין שיבוץ או אילוץ */}
      {selectedSlotDates && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(58, 33, 25, 0.6)', zIndex: 4000, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <div style={{ background: theme.backgroundcolor, border: `2px solid ${theme.darkgreen}`, padding: '25px', borderRadius: '10px', width: '320px', textAlign: 'center', position: 'relative' }}>
            <button onClick={() => setSelectedSlotDates(null)} style={{ position: 'absolute', top: '10px', left: '10px', background: 'transparent', border: 'none', fontSize: '20px', cursor: 'pointer', color: theme.darkgreen }}>✖</button>
            <h3 style={{ marginTop: 0, color: theme.lightgreen }}>בחר/י מה תרצה/י להוסיף</h3>
            <p style={{ color: theme.lightgreen, marginBottom: '20px', fontWeight: 'bold' }}>
              {selectedSlotDates.startDate === selectedSlotDates.endDate
                ? `לתאריך: ${formatDateHe(selectedSlotDates.startDate)}`
                : `לסופ"ש/טווח: ${formatDateHe(selectedSlotDates.startDate)} - ${formatDateHe(selectedSlotDates.endDate)}`}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {currentUser.role === 'admin' && (
                <button onClick={() => { setFormData({ startDate: selectedSlotDates.startDate, endDate: selectedSlotDates.endDate, userId: '', shiftTypeId: '', isWeekend: hasShabbat, isBaltam: false, notes: '' }); setEditingShiftId(null); setIsModalOpen(true); setSelectedSlotDates(null); }} style={{ padding: '12px', background: theme.pink, color: theme.darkgreen, border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold', fontSize: '15px' }}>
                  שיבוץ תורנות
                </button>
              )}
              <button onClick={() => { setConstraintFormData({ startDate: selectedSlotDates.startDate, endDate: selectedSlotDates.endDate, userId: currentUser.role === 'admin' ? '' : currentUser.id, division: '', reason: '' }); setIsConstraintModalOpen(true); setSelectedSlotDates(null); }} style={{ padding: '12px', background: theme.pink, color: theme.darkgreen, border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold', fontSize: '15px' }}>
                חסימת אילוץ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* חלון תאריכי שכפול */}
      {isDuplicateModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(58, 33, 25, 0.6)', zIndex: 3000, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <div style={{ background: theme.backgroundcolor, padding: '30px', borderRadius: '10px', width: '400px', position: 'relative' }}>
            <button onClick={() => { setIsDuplicateModalOpen(false); setShiftToDuplicate(null); }} style={{ position: 'absolute', top: '10px', left: '10px', background: 'transparent', border: 'none', fontSize: '20px', cursor: 'pointer', color: theme.darkgreen }}>✖</button>
            <h2 style={{ marginTop: 0, paddingBottom: '10px', color: theme.darkgreen }}>תאריכים לתורנות המשוכפלת</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', marginTop: '20px', color: theme.darkgreen }}>
              <div><label>תאריך התחלה חדש:</label><input type="date" value={duplicateFormData.startDate} onChange={(e) => handleDateSelection('duplicate', 'startDate', e.target.value)} style={{ width: '100%', padding: '8px', boxSizing: 'border-box', borderRadius: "15px", backgroundColor: theme.backgroundcolor, border: `1px solid ${theme.darkgreen}`, color: theme.darkgreen }} /></div>
              <div><label>תאריך סיום חדש:</label><input type="date" value={duplicateFormData.endDate} onChange={(e) => handleDateSelection('duplicate', 'endDate', e.target.value)} style={{ width: '100%', padding: '8px', boxSizing: 'border-box', borderRadius: "15px", backgroundColor: theme.backgroundcolor, border: `1px solid ${theme.darkgreen}`, color: theme.darkgreen }} /></div>
              <div><label>בחר חייל:</label><select value={duplicateFormData.userId} onChange={(e) => setDuplicateFormData({ ...duplicateFormData, userId: e.target.value })} style={{ width: '100%', padding: '8px', boxSizing: 'border-box', borderRadius: "15px", backgroundColor: theme.backgroundcolor, border: `1px solid ${theme.darkgreen}`, color: theme.darkgreen }}><option value="">בחר חייל</option>{getAvailableSoldiers().map(u => (<option key={u.id} value={u.id}>{u.full_name}</option>))}</select></div>
              <button onClick={handleSaveDuplicate} style={{ padding: '12px', marginTop: "10px", background: theme.pink, color: theme.darkgreen, border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold', fontSize: '15px' }}>אשר ושבץ משוכפל</button>
            </div>
          </div>
        </div>
      )}

      {/* חלון בחירת פרסום / ביטול פרסום */}
      {isPublishChoiceOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(58, 33, 25, 0.6)', zIndex: 3000, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <div style={{ background: theme.darkgreen, padding: '30px', borderRadius: '10px', width: '320px', textAlign: 'center', border: `2px solid ${theme.pink}`, position: 'relative' }}>
            <button onClick={() => setIsPublishChoiceOpen(false)} style={{ position: 'absolute', top: '10px', left: '10px', background: 'transparent', border: 'none', fontSize: '20px', cursor: 'pointer', color: theme.backgroundcolor }}>✖</button>

            <h3 style={{ marginTop: 0, color: theme.backgroundcolor }}>בחר/י מה תרצה/י לעשות</h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '20px' }}>
              <button onClick={() => { setIsPublishChoiceOpen(false); setIsPublishModalOpen(true); }} style={{ padding: '12px', fontSize: "20px", background: theme.backgroundcolor, color: theme.pink, border: `2px solid ${theme.pink}`, borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold' }}>
                פרסם תורנויות
              </button>
              <button onClick={() => { setIsPublishChoiceOpen(false); setIsUnpublishModalOpen(true); }} style={{ padding: '12px', fontSize: "20px", background: theme.backgroundcolor, color: theme.pink, border: `2px solid ${theme.pink}`, borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold' }}>
                בטל פרסום
              </button>
            </div>
          </div>
        </div>
      )}

      {/* חלון הוספת אילוץ */}
      {isConstraintModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(58, 33, 25, 0.6)', zIndex: 3000, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <div style={{ background: theme.backgroundcolor, padding: '30px', borderRadius: '10px', width: '400px', position: 'relative' }}>
            <button onClick={() => setIsConstraintModalOpen(false)} style={{ position: 'absolute', top: '10px', left: '10px', background: 'transparent', border: 'none', fontSize: '20px', cursor: 'pointer', color: theme.darkgreen }}>✖</button>
            <h2 style={{ marginTop: 0, paddingBottom: '10px', color: theme.darkgreen }}>חסימת אילוץ בלוח</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', marginTop: '20px', color: theme.darkgreen }}>
              <div><label>תאריך התחלה:</label><input type="date" value={constraintFormData.startDate} onChange={(e) => handleDateSelection('constraint', 'startDate', e.target.value)} style={{ width: '100%', padding: '8px', boxSizing: 'border-box', borderRadius: "15px", backgroundColor: theme.backgroundcolor, border: `1px solid ${theme.darkgreen}`, color: theme.darkgreen }} /></div>
              <div><label>תאריך סיום:</label><input type="date" value={constraintFormData.endDate} onChange={(e) => handleDateSelection('constraint', 'endDate', e.target.value)} style={{ width: '100%', padding: '8px', boxSizing: 'border-box', borderRadius: "15px", backgroundColor: theme.backgroundcolor, border: `1px solid ${theme.darkgreen}`, color: theme.darkgreen }} /></div>

              <div>
                <label>סוג אילוץ:</label>
                <select value={constraintTarget} onChange={(e) => setConstraintTarget(e.target.value)} style={{ width: '45%', padding: '8px', marginRight: "10px", boxSizing: 'border-box', borderRadius: "15px", backgroundColor: theme.backgroundcolor, border: `1px solid ${theme.darkgreen}`, color: theme.darkgreen }}>
                  <option value="soldier">חייל ספציפי</option>
                  <option value="division">גף שלם</option>
                  <option value="squadron">כל הטייסת</option>
                </select>
              </div>

              {constraintTarget === 'soldier' && (
                <div>
                  <select
                    value={constraintFormData.userId}
                    onChange={(e) => setConstraintFormData({ ...constraintFormData, userId: e.target.value })}
                    style={{ width: '100%', padding: '8px', boxSizing: 'border-box', borderRadius: "15px", backgroundColor: theme.backgroundcolor, border: `1px solid ${theme.darkgreen}`, color: theme.darkgreen }}
                  >
                    <option value="">בחר חייל</option>
                    {getAvailableSoldiers().map(u => (
                      <option key={u.id} value={u.id}>{u.full_name}</option>
                    ))}
                  </select>
                </div>
              )}

              {constraintTarget === 'division' && (
                <div>
                  <select
                    value={constraintFormData.division || ''}
                    onChange={(e) => setConstraintFormData({ ...constraintFormData, division: e.target.value })}
                    onFocus={fetchDivisions}
                    style={{ width: '100%', padding: '8px', boxSizing: 'border-box', borderRadius: "15px", backgroundColor: theme.backgroundcolor, border: `1px solid ${theme.darkgreen}`, color: theme.darkgreen }}
                  >
                    <option value="">בחר גף</option>
                    {availableDivisions.map(div => (
                      <option key={div} value={div}>{div}</option>
                    ))}
                  </select>
                </div>
              )}

              <div><label>סיבת האילוץ:</label><input type="text" placeholder="לדוגמה: גימלים, קורס" value={constraintFormData.reason} onChange={(e) => setConstraintFormData({ ...constraintFormData, reason: e.target.value })} style={{ width: '100%', padding: '8px', boxSizing: 'border-box', borderRadius: "15px", backgroundColor: theme.backgroundcolor, border: `1px solid ${theme.darkgreen}`, color: theme.darkgreen }} /></div>
              <button onClick={handleSaveConstraint} style={{ padding: '12px', fontSize: "20px", background: theme.pink, color: theme.darkgreen, border: `2px solid ${theme.pink}`, borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold' }}>חסום בלוח</button>
            </div>
          </div>
        </div>
      )}

      {/* חלון הגדרות */}
      {isSettingsOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(58, 33, 25, 0.6)', zIndex: 3000, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <div style={{ background: theme.backgroundcolor, padding: '30px', borderRadius: '20px', width: '550px', position: 'relative', display: 'flex', flexDirection: 'column', maxHeight: '85vh', overflow: 'hidden', color: theme.darkgreen }}>
            <div style={{ flexShrink: 0 }}>
              <button onClick={() => setIsSettingsOpen(false)} style={{ position: 'absolute', top: '10px', left: '10px', background: 'transparent', border: 'none', fontSize: '25px', cursor: 'pointer', color: theme.darkgreen }}>✖</button>
              <h2 style={{ margin: 0, fontSize: "25px", paddingBottom: '10px', color: theme.darkgreen }}>הגדרות מערכת</h2>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '0 30px 30px 30px', direction: "ltr" }}>
              <div style={{ direction: 'rtl' }}>
                <div style={{ marginBottom: '20px', background: theme.pink, padding: '15px', borderRadius: '20px', marginTop: '15px' }}>
                  <h3 style={{ marginTop: 0, fontSize: '20px', color: theme.darkgreen }}>הפרטים שלי</h3>
                  <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                    <input type="text" value={adminMyName} onChange={(e) => setAdminMyName(e.target.value)} style={{ flex: 1, padding: '8px', borderRadius: "15px", backgroundColor: theme.backgroundcolor, border: `1px solid ${theme.darkgreen}` }} placeholder="שם משתמש" />
                    <input type="password" value={adminMyPassword} onChange={(e) => setAdminMyPassword(e.target.value)} style={{ flex: 1, padding: '8px', backgroundColor: theme.backgroundcolor, borderRadius: "15px", border: `1px solid ${theme.darkgreen}` }} placeholder="סיסמה חדשה" />
                  </div>
                  <div style={{ marginBottom: '10px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer', fontWeight: 'bold', fontSize: '14px' }}>
                      <input
                        type="checkbox"
                        checked={adminDoesShifts}
                        onChange={(e) => setAdminDoesShifts(e.target.checked)}
                      />אני משתלב בסבב התורנויות
                    </label>
                  </div>
                  <button onClick={handleUpdateOneself} style={{ padding: '8px 15px', background: theme.backgroundcolor, color: theme.darkgreen, border: `1px solid ${theme.darkgreen}`, borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold' }}>עדכן פרטים</button>
                </div>

                <div style={{ marginBottom: '20px', background: theme.darkgreen, padding: '15px', borderRadius: '20px' }}>
                  <h3 style={{ marginTop: 0, fontSize: '20px', marginBottom: '12px', color: theme.backgroundcolor }}>הוספת חייל חדש</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div style={{ display: 'flex', gap: '10px' }}>
                      <div style={{ flex: 1 }}>
                        <label style={{ fontSize: '15px', display: 'block', marginBottom: '2px', color: theme.backgroundcolor, textAlign: "right" }}>שם מלא</label>
                        <input type="text" value={newUserName} onChange={(e) => setNewUserName(e.target.value)} style={{ width: '100%', padding: '8px', boxSizing: 'border-box', borderRadius: "15px", backgroundColor: theme.backgroundcolor, border: `1px solid ${theme.darkgreen}` }} placeholder="שם מלא" />
                      </div>
                      <div style={{ flex: 1 }}>
                        <label style={{ fontSize: '15px', display: 'block', marginBottom: '2px', color: theme.backgroundcolor, textAlign: "right" }}>סיסמא</label>
                        <input type="text" value={newUserPassword} onChange={(e) => setNewUserPassword(e.target.value)} style={{ width: '100%', padding: '8px', boxSizing: 'border-box', borderRadius: "15px", backgroundColor: theme.backgroundcolor, border: `1px solid ${theme.darkgreen}` }} placeholder="סיסמא" />
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                      <div style={{ flex: 1 }}>
                        <label style={{ fontSize: '15px', display: 'block', marginBottom: '2px', color: theme.backgroundcolor, textAlign: "right" }}>תאריך שחרור:</label>
                        <input type="date" value={newUserReleaseDate} onChange={(e) => setNewUserReleaseDate(e.target.value)} style={{ width: '100%', padding: '8px', boxSizing: 'border-box', borderRadius: "15px", backgroundColor: theme.backgroundcolor, border: `1px solid ${theme.darkgreen}` }} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <label style={{ fontSize: '15px', display: 'block', marginBottom: '2px', color: theme.backgroundcolor, textAlign: "right" }}>פוטנציאל תורנויות (%):</label>
                        <input type="number" min="0" max="100" value={newUserPotential} onChange={(e) => setNewUserPotential(e.target.value)} style={{ width: '100%', padding: '8px', boxSizing: 'border-box', borderRadius: "15px", backgroundColor: theme.backgroundcolor, border: `1px solid ${theme.darkgreen}` }} placeholder="100" />
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                      <div style={{ flex: 1 }}>
                        <label style={{ fontSize: '15px', display: 'block', marginBottom: '5px', color: theme.backgroundcolor, textAlign: "right" }}>גף</label>
                        <input
                          type="text"
                          list="divisionsList"
                          value={newUserDivision || ''}
                          onChange={(e) => setNewUserDivision(e.target.value)}
                          onFocus={fetchDivisions}
                          placeholder="בחר או הקלד גף חדש..."
                          style={{ width: '100%', padding: '8px', boxSizing: 'border-box', borderRadius: "15px", backgroundColor: theme.backgroundcolor, border: `1px solid ${theme.darkgreen}`, color: theme.darkgreen }}
                        />
                        <datalist id="divisionsList">
                          {availableDivisions.map((div, index) => (
                            <option key={index} value={div} />
                          ))}
                        </datalist>
                      </div>
                      <div style={{ flex: 1 }}>
                        <label style={{ fontSize: '15px', display: 'block', marginBottom: '2px', color: theme.backgroundcolor, textAlign: "right" }}>מגדר:</label>
                        <select value={newUserGender} onChange={(e) => setNewUserGender(e.target.value)} style={{ width: '100%', padding: '8px', boxSizing: 'border-box', borderRadius: "15px", backgroundColor: theme.backgroundcolor, border: `1px solid ${theme.darkgreen}` }}>
                          <option value="male">זכר</option>
                          <option value="female">נקבה</option>
                        </select>
                      </div>
                    </div>
                    <div style={{ padding: '15px', borderRadius: '8px' }}>
                      <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '10px', color: theme.backgroundcolor, textAlign: "right" }}>פטורים (במידה ויש):</label>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '15px' }}>
                        {exemptionTypes.map(exemption => (
                          <label key={exemption.id} style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer', background: theme.backgroundcolor, padding: '5px 10px', borderRadius: '10px' }}>
                            <input type="checkbox" checked={newUserExemptionIds.includes(exemption.id)} onChange={(e) => {
                              if (e.target.checked) setNewUserExemptionIds([...newUserExemptionIds, exemption.id]);
                              else setNewUserExemptionIds(newUserExemptionIds.filter(id => id !== exemption.id));
                            }} />
                            {exemption.name}
                          </label>
                        ))}
                      </div>
                    </div>
                    <button onClick={handleSaveUser} style={{ padding: '8px 15px', background: theme.backgroundcolor, color: theme.darkgreen, border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: 'bold', marginTop: '15px', fontSize: "20px", margin: "auto" }}>הוסף חייל</button>
                  </div>
                </div>

                <div style={{ marginBottom: '20px', background: theme.pink, padding: '15px', borderRadius: '20px' }}>
                  <h3 style={{ marginTop: 0, fontSize: '20px', marginBottom: '10px', color: theme.darkgreen }}>ניהול חיילים קיימים</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', maxHeight: '180px', overflowY: 'auto', marginBottom: '10px' }}>
                    {users.filter(u => u.role === 'soldier' && u.is_active === 1).map(soldier => (
                      <div key={soldier.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: theme.backgroundcolor, padding: '8px', borderRadius: '15px', border: `1px solid ${theme.darkgreen}` }}>
                        <span style={{ fontSize: '18px', fontWeight: 'bold' }}>{soldier.full_name}</span>
                        <div style={{ display: 'flex', gap: '5px' }}>
                          <button onClick={() => setEditingSoldier({ id: soldier.id, full_name: soldier.full_name, password: '', release_date: soldier.release_date || '', potential_reduction: soldier.potential_reduction || 100, exemptionIds: soldier.exemptionIds || [], does_shifts: soldier.does_shifts })} style={{ background: theme.backgroundcolor, color: theme.darkgreen, border: `1px solid ${theme.darkgreen}`, borderRadius: '7px', padding: '3px 8px', cursor: 'pointer', fontSize: '12px' }}>ערוך</button>
                          <button onClick={() => handleDeleteSoldier(soldier.id)} style={{ background: theme.backgroundcolor, color: theme.darkgreen, border: `1px solid ${theme.darkgreen}`, borderRadius: '7px', padding: '3px 8px', cursor: 'pointer', fontSize: '12px' }}>מחק</button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {editingSoldier && (
                    <div style={{ background: theme.pink, padding: '12px', borderRadius: '5px', marginTop: '10px' }}>
                      <h4 style={{ margin: '0 0 10px 0', fontSize: '14px', color: theme.darkgreen }}>עריכת חייל: <strong>{editingSoldier.full_name}</strong></h4>
                      <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                        <input type="text" value={editingSoldier.full_name} onChange={(e) => setEditingSoldier({ ...editingSoldier, full_name: e.target.value })} style={{ flex: 1, padding: '6px', borderRadius: "15px", backgroundColor: theme.backgroundcolor, border: `1px solid ${theme.darkgreen}` }} placeholder="שם חייל" />
                        <input type="text" value={editingSoldier.password} onChange={(e) => setEditingSoldier({ ...editingSoldier, password: e.target.value })} style={{ flex: 1, padding: '6px', borderRadius: "15px", backgroundColor: theme.backgroundcolor, border: `1px solid ${theme.darkgreen}` }} placeholder="סיסמה חדשה (אופציונלי)" />
                      </div>
                      <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                        <div style={{ flex: 1 }}>
                          <label style={{ fontSize: '11px', display: 'block', marginBottom: '2px' }}>תאריך שחרור:</label>
                          <input type="date" value={editingSoldier.release_date} onChange={(e) => setEditingSoldier({ ...editingSoldier, release_date: e.target.value })} style={{ width: '100%', padding: '6px', boxSizing: 'border-box', borderRadius: "15px", backgroundColor: theme.backgroundcolor, border: `1px solid ${theme.darkgreen}` }} />
                        </div>
                        <div style={{ flex: 1 }}>
                          <label style={{ fontSize: '11px', display: 'block', marginBottom: '2px' }}>פוטנציאל (%):</label>
                          <input type="number" min="0" max="100" value={editingSoldier.potential_reduction} onChange={(e) => setEditingSoldier({ ...editingSoldier, potential_reduction: e.target.value })} style={{ width: '100%', padding: '6px', boxSizing: 'border-box', borderRadius: "15px", backgroundColor: theme.backgroundcolor, border: `1px solid ${theme.darkgreen}` }} />
                        </div>
                      </div>
                      <div style={{ marginBottom: '15px', marginTop: '15px' }}>
                        <label style={{ fontSize: '17px', fontWeight: 'bold', textAlign: "right", display: 'block', marginBottom: '5px' }}>פטורים פעילים:</label>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                          {exemptionTypes.map(exemption => (
                            <label key={exemption.id} style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', background: theme.backgroundcolor, padding: '4px 8px', borderRadius: '10px', border: `1px solid ${theme.darkgreen}`, cursor: 'pointer' }}>
                              <input
                                type="checkbox"
                                checked={editingSoldier.exemptionIds?.includes(exemption.id) || false}
                                onChange={(e) => {
                                  const currentIds = editingSoldier.exemptionIds || [];
                                  const newIds = e.target.checked
                                    ? [...currentIds, exemption.id]
                                    : currentIds.filter(id => id !== exemption.id);

                                  setEditingSoldier({ ...editingSoldier, exemptionIds: newIds });
                                }}
                              />
                              {exemption.name}
                            </label>
                          ))}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '5px' }}>
                        <button onClick={() => { handleUpdateSoldier(editingSoldier.id, editingSoldier.full_name, editingSoldier.password, editingSoldier.release_date, editingSoldier.potential_reduction, editingSoldier.exemptionIds); }} style={{ background: theme.backgroundcolor, color: theme.darkgreen, border: `1px solid ${theme.darkgreen}`, borderRadius: '3px', padding: '5px 10px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}>שמור שינויים</button>
                        <button onClick={() => setEditingSoldier(null)} style={{ background: theme.backgroundcolor, color: theme.darkgreen, border: `1px solid ${theme.darkgreen}`, borderRadius: '3px', padding: '5px 10px', cursor: 'pointer', fontSize: '12px' }}>ביטול</button>
                      </div>
                    </div>
                  )}
                </div>

                {/* אזור ניהול תקופות מותאמות אישית */}
                <div style={{ marginBottom: '20px', background: theme.darkgreen, padding: '15px', borderRadius: '20px', border: `1.5px solid ${theme.darkgreen}` }}>
                  <h3 style={{ marginTop: 0, fontSize: '20px', color: theme.backgroundcolor }}>ניהול טווחי תקופות</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
                    {customPeriods.map((period, index) => (
                      <div key={index} style={{ display: 'flex', gap: '4px', alignItems: 'center', background: theme.backgroundcolor, padding: '8px', borderRadius: '12px' }}>
                        <input
                          type="text"
                          value={period.name}
                          onChange={(e) => {
                            const updated = [...customPeriods];
                            updated[index].name = e.target.value;
                            setCustomPeriods(updated);
                          }}
                          style={{ width: '55px', padding: '5px', borderRadius: '8px', border: `1px solid ${theme.darkgreen}`, textAlign: 'center', fontWeight: 'bold', backgroundColor: theme.backgroundcolor }}
                          placeholder="שם"
                        />
                        <input
                          type="date"
                          value={period.startDate}
                          onChange={(e) => {
                            const updated = [...customPeriods];
                            updated[index].startDate = e.target.value;
                            setCustomPeriods(updated);
                          }}
                          style={{ flex: 1, padding: '5px', borderRadius: '8px', border: `1px solid ${theme.darkgreen}`, backgroundColor: theme.backgroundcolor, width: "115px" }}
                        />
                        <span>עד</span>
                        <input
                          type="date"
                          value={period.endDate}
                          onChange={(e) => {
                            const updated = [...customPeriods];
                            updated[index].endDate = e.target.value;
                            setCustomPeriods(updated);
                          }}
                          style={{ flex: 1, padding: '5px', borderRadius: '8px', border: `1px solid ${theme.darkgreen}`, backgroundColor: theme.backgroundcolor, width: "115px" }}
                        />
                        <button
                          onClick={() => {
                            const updated = customPeriods.filter((_, i) => i !== index);
                            savePeriodsToServer(updated);
                          }}
                          style={{ background: '#dc3545', color: 'white', border: 'none', borderRadius: '6px', padding: '5px 8px', cursor: 'pointer', fontSize: '12px' }}
                        >
                          מחק
                        </button>
                      </div>
                    ))}
                  </div>

                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button
                      onClick={() => {
                        const newName = prompt("הקלידי שם תקופה חדשה (למשל 1.27):");
                        if (newName) {
                          setCustomPeriods([...customPeriods, { name: newName, startDate: '', endDate: '' }]);
                        }
                      }}
                      style={{ padding: '6px 12px', background: theme.pink, color: theme.darkgreen, border: `1px solid ${theme.darkgreen}`, borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px' }}
                    >
                      הוסף תקופה חדשה
                    </button>
                    <button
                      onClick={() => savePeriodsToServer(customPeriods)}
                      style={{ padding: '6px 12px', background: theme.pink, color: theme.darkgreen, border: `1px solid ${theme.darkgreen}`, borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px' }}
                    >
                      שמור
                    </button>
                  </div>
                </div>

                {/* יצירת סוג תורנות חדש */}
                <div style={{ background: theme.pink, padding: '15px', borderRadius: '20px', marginTop: '15px' }}>
                  <h3 style={{ marginTop: 0, fontSize: '20px', color: theme.darkgreen }}>יצירת סוג תורנות חדש</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <input
                      type="text"
                      value={shiftTypeForm.name}
                      onChange={(e) => setShiftTypeForm({ ...shiftTypeForm, name: e.target.value })}
                      style={{ width: '100%', padding: '8px', boxSizing: 'border-box', borderRadius: "15px", backgroundColor: theme.backgroundcolor, border: `1px solid ${theme.darkgreen}` }}
                      placeholder="שם התורנות"
                    />
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                      <label style={{ fontSize: '14px', color: theme.darkgreen }}>בחר צבע פנוי:</label>
                      {getAvailableColors().map((colorOption) => (
                        <button
                          key={colorOption.value}
                          type="button"
                          onClick={() => setShiftTypeForm(prev => ({ ...prev, color: colorOption.value }))}
                          style={{
                            width: '30px',
                            height: '30px',
                            borderRadius: '50%',
                            backgroundColor: colorOption.value,
                            border: shiftTypeForm.color === colorOption.value ? `3px solid ${theme.darkgreen}` : 'none',
                            cursor: 'pointer'
                          }}
                        />
                      ))}
                    </div>
                    <div style={{ alignItems: "right", marginLeft: "70px" }}>
                      <label style={{ color: theme.darkgreen, fontSize: "13px" }}>ערך נקודות ליום:</label>
                      <input
                        type="number"
                        step="0.5"
                        style={{ width: '70%', padding: '6px', borderRadius: "15px", marginRight: "5px", backgroundColor: theme.backgroundcolor, border: `1px solid ${theme.darkgreen}`, color: theme.darkgreen }}
                        value={shiftTypeForm.points_base}
                        onChange={(e) => setShiftTypeForm({ ...shiftTypeForm, points_base: parseFloat(e.target.value) || 1.0 })}
                        placeholder="לדוגמה: 1"
                      />
                    </div>
                    <div style={{ marginTop: '10px' }}>
                      <label style={{ color: theme.darkgreen, fontSize: "13px" }}>הגבלת מגדר לתורנות:</label>
                      <select value={newShiftTypeGenderLimit} onChange={(e) => setNewShiftTypeGenderLimit(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: "15px", backgroundColor: theme.backgroundcolor, border: `1px solid ${theme.darkgreen}` }}>
                        <option value="all">כולם</option>
                        <option value="male">בנים בלבד</option>
                        <option value="female">בנות בלבד</option>
                      </select>
                    </div>
                    <button onClick={handleSaveShiftType} style={{ padding: '8px 15px', background: theme.backgroundcolor, color: theme.darkgreen, fontSize: "15px", fontWeight: "bold", borderRadius: '5px', cursor: 'pointer', alignSelf: 'flex-start', border: `1px solid ${theme.darkgreen}` }}>צור סוג תורנות</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* חלון שיבוץ / עריכת תורנות */}
      {isModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(58, 33, 25, 0.15)', zIndex: 2000, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <div style={{ background: theme.backgroundcolor, padding: '30px', borderRadius: '10px', width: '400px', position: 'relative', color: theme.darkgreen, border: `2px solid ${theme.darkgreen}`, boxShadow: '0 10px 30px rgba(0,0,0,0.3)' }}>
            <button onClick={() => setIsModalOpen(false)} style={{ position: 'absolute', top: '10px', left: '10px', background: 'transparent', border: 'none', fontSize: '20px', cursor: 'pointer', color: theme.darkgreen }}>✖</button>
            <h2 style={{ marginTop: 0, paddingBottom: '10px', color: theme.darkgreen }}>{editingShiftId ? 'עריכת תורנות' : 'שיבוץ תורנות חדשה'}</h2>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', marginTop: '20px' }}>
              <div>
                <label>תאריך התחלה:</label>
                <input
                  type="date"
                  value={formData.startDate}
                  onChange={(e) => {
                    const newStart = e.target.value;
                    const isWeekend = doesRangeContainShabbat(newStart, formData.endDate);
                    setFormData({ ...formData, startDate: newStart, isWeekend: isWeekend });
                    checkConflict(formData.userId, newStart, formData.endDate, formData.shiftTypeId);
                  }}
                  style={{ width: '100%', padding: '6px', boxSizing: 'border-box', borderRadius: "15px", backgroundColor: theme.backgroundcolor, border: `1px solid ${theme.darkgreen}`, color: theme.darkgreen }}
                />
              </div>

              <div>
                <label>תאריך סיום:</label>
                <input
                  type="date"
                  value={formData.endDate}
                  onChange={(e) => {
                    const newEnd = e.target.value;
                    const isWeekend = doesRangeContainShabbat(formData.startDate, newEnd);
                    setFormData({ ...formData, endDate: newEnd, isWeekend: isWeekend });
                    checkConflict(formData.userId, formData.startDate, newEnd, formData.shiftTypeId);
                  }}
                  style={{ width: '100%', padding: '6px', boxSizing: 'border-box', borderRadius: "15px", backgroundColor: theme.backgroundcolor, border: `1px solid ${theme.darkgreen}`, color: theme.darkgreen }}
                />
            </div>

            <div>
              <label>בחר חייל:</label>
              <select
                value={formData.userId}
                onChange={(e) => {
                  const newUserId = e.target.value;
                  setFormData({ ...formData, userId: newUserId });
                  checkConflict(newUserId, formData.startDate, formData.endDate, formData.shiftTypeId);
                }}
                style={{ width: '100%', padding: '6px', boxSizing: 'border-box', borderRadius: "15px", backgroundColor: theme.backgroundcolor, border: `1px solid ${theme.darkgreen}`, color: theme.darkgreen }}
              >
                <option value="">בחר חייל</option>
                {getAvailableSoldiers().map(u => (
                  <option key={u.id} value={u.id}>{u.full_name}</option>
                ))}
              </select>
            </div>

            <div>
              <label>סוג תורנות:</label>
              <select
                value={formData.shiftTypeId}
                onChange={(e) => {
                  const newTypeId = e.target.value;
                  setFormData({ ...formData, shiftTypeId: newTypeId });
                  checkConflict(formData.userId, formData.startDate, formData.endDate, newTypeId);
                }}
                style={{ width: '100%', padding: '6px', boxSizing: 'border-box', borderRadius: "15px", backgroundColor: theme.backgroundcolor, border: `1px solid ${theme.darkgreen}`, color: theme.darkgreen }}
              >
                <option value="">בחר סוג תורנות</option>
                {shiftTypes.map(t => (<option key={t.id} value={t.id}>{t.name}</option>))}
              </select>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '5px' }}>הערות:</label>
              <textarea
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                style={{
                  width: '100%',
                  padding: '8px',
                  boxSizing: 'border-box',
                  borderRadius: "15px",
                  backgroundColor: theme.backgroundcolor,
                  border: `1.5px solid ${theme.darkgreen}`,
                  color: theme.darkgreen,
                  minHeight: '80px',
                  resize: 'vertical'
                }}
                placeholder="הוסיפי הערה לתורנות..."
              />
            </div>

            <div style={{ display: 'flex', gap: '20px', marginTop: '5px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer', fontWeight: 'bold' }}>
                <input type="checkbox" checked={formData.isWeekend} onChange={(e) => setFormData({ ...formData, isWeekend: e.target.checked })} /> שבת
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer', fontWeight: 'bold' }}>
                <input type="checkbox" checked={displayBaltam} disabled={forcedBaltam} onChange={(e) => setFormData({ ...formData, isBaltam: e.target.checked })} /> בלת"ם
              </label>
              {editingShiftId && (
                <label style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer', fontWeight: 'bold' }}>
                  <input
                    type="checkbox"
                    checked={hasReplacement}
                    onChange={async (e) => {
                      const isChecked = e.target.checked;

                      if (!isChecked) {
                        const cleanShiftId = editingShiftId ? String(editingShiftId).split('-')[0] : null;
                        const currentExemption = shiftExemptions.find(ex => String(ex.shift_id) === cleanShiftId) || (replacementData.id ? replacementData : null);

                        if (currentExemption && currentExemption.id) {
                          try {
                            await fetch(`${API_BASE}/api/shift-exemptions/${currentExemption.id}`, { method: 'DELETE' });
                          } catch (err) {
                            console.error("שגיאה במחיקת החלפה:", err);
                          }
                        }

                        setHasReplacement(false);
                        setReplacementData({ shift_id: '', start_date: '', end_date: '', type: 'pet' });
                        setReplacementForm({ type: 'pet', startDate: '', endDate: '', startTime: '', endTime: '' });
                        await fetchShiftExemptions();
                        await fetchShifts();
                      } else {
                        setHasReplacement(true);
                        setIsReplacementModalOpen(true);
                      }
                    }}
                  />
                  הוסף החלפה
                </label>
              )}
            </div>

            <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
              <button onClick={handleSaveShift} style={{ flex: 1, padding: '12px', background: theme.pink, color: theme.darkgreen, border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold', fontSize: '15px' }}>{editingShiftId ? 'עדכן' : 'שמור ושבץ'}</button>
              {editingShiftId && <button onClick={handleDelete} style={{ flex: 1, padding: '12px', background: theme.pink, color: theme.darkgreen, border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold', fontSize: '15px' }}>מחק</button>}
              <button onClick={handleDuplicateClick} style={{ flex: 1, padding: '12px', background: theme.pink, color: theme.darkgreen, border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold', fontSize: '15px' }}>
                שכפל
              </button>
              {editingShiftId && (
                <button onClick={() => setIsSplitModalOpen(true)} style={{ flex: 1, padding: '12px', background: theme.pink, color: theme.darkgreen, border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold', fontSize: '15px' }}>
                  פצל תורנות
                </button>
              )}
            </div>

            {isSplitModalOpen && (
              <div style={{ background: theme.darkgreen, padding: '15px', borderRadius: '8px', marginTop: '5px' }}>
                <h4 style={{ margin: '0 0 10px 0', color: theme.pink }}>פיצול תורנות</h4>
                <p style={{ fontSize: '12px', margin: '0 0 10px 0', color: theme.pink }}>בחר מאיזה תאריך להתחיל את החלק השני של התורנות (החלק המפוצל ייווצר כמשבצת ריקה ללא חייל):</p>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <input type="date" value={splitDate} onChange={(e) => setSplitDate(e.target.value)} min={formData.startDate} max={formData.endDate} style={{ flex: 1, padding: '8px', backgroundColor: theme.pink, color: theme.darkgreen, borderRadius: '6px' }} />
                  <button onClick={handleSplitShift} style={{ flex: 1, padding: '8px', background: theme.pink, color: theme.darkgreen, border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold', fontSize: '15px' }}>בצע חיתוך</button>
                  <button onClick={() => setIsSplitModalOpen(false)} style={{ flex: 1, padding: '5px', background: theme.pink, color: theme.darkgreen, border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold', fontSize: '15px' }}>ביטול</button>
                </div>
              </div>
            )}
          </div>
        </div>
        </div>
  )
}

{/* חלון הוספת / עריכת החלפה (פט / טייסת) */ }
{
  isReplacementModalOpen && (
    <div style={{ position: "fixed", top: "0", left: "0", width: "100%", height: "100%", background: "rgba(0, 0, 0, 0.6)", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 99999 }}>
      <div style={{ background: theme.backgroundcolor, padding: "25px", borderRadius: "15px", width: "350px", display: "flex", flexDirection: "column", gap: "15px" }}>
        <button onClick={() => {
          setIsReplacementModalOpen(false);
          if (!replacementData.id) setHasReplacement(false);
          setReplacementForm({ type: 'pet', startDate: '', endDate: '', startTime: '', endTime: '' });
        }} style={{ position: "relative", top: '-13px', right: '150px', background: 'transparent', border: 'none', fontSize: '20px', cursor: 'pointer', color: theme.darkgreen }}>✖</button>

        <h3 style={{ marginTop: "-20px" }}>פרטי החלפה</h3>
        <label style={{ fontSize: '15px', display: 'block', marginTop: "-10px", marginBottom: '-5px', color: theme.darkgreen, textAlign: "right" }}>
          בחירת סוג החלפה
        </label>
        <select
          value={replacementForm.type || 'pet'}
          onChange={(e) => setReplacementForm({ ...replacementForm, type: e.target.value })}
          style={{ width: '100%', padding: '6px', boxSizing: 'border-box', borderRadius: "15px", backgroundColor: theme.backgroundcolor, border: `1px solid ${theme.darkgreen}`, color: theme.darkgreen }}
        >
          <option value="pet">החלפת פרח טיס (פט)</option>
          <option value="squadron">החלפה עם טייסת אחרת</option>
        </select>

        <div style={{ display: 'flex', gap: '10px' }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: '15px', display: 'block', marginBottom: '2px', color: theme.darkgreen, textAlign: "right" }}>תאריך התחלה</label>
            <input
              type="date"
              value={replacementForm.startDate}
              min={shifts.find(s => String(s.id) === String(editingShiftId))?.originalStart?.split('T')[0]}
              max={shifts.find(s => String(s.id) === String(editingShiftId))?.originalEnd?.split('T')[0]}
              onChange={(e) => setReplacementForm({ ...replacementForm, startDate: e.target.value })}
              style={{ width: '100%', padding: '6px', boxSizing: 'border-box', borderRadius: "15px", backgroundColor: theme.backgroundcolor, border: `1px solid ${theme.darkgreen}`, color: theme.darkgreen }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: '15px', display: 'block', marginBottom: '2px', color: theme.darkgreen, textAlign: "right" }}>תאריך סיום</label>
            <input
              type="date"
              value={replacementForm.endDate}
              min={shifts.find(s => String(s.id) === String(editingShiftId))?.originalStart?.split('T')[0]}
              max={shifts.find(s => String(s.id) === String(editingShiftId))?.originalEnd?.split('T')[0]}
              onChange={(e) => setReplacementForm({ ...replacementForm, endDate: e.target.value })}
              style={{ width: '100%', padding: '6px', boxSizing: 'border-box', borderRadius: "15px", backgroundColor: theme.backgroundcolor, border: `1px solid ${theme.darkgreen}`, color: theme.darkgreen }}
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: '15px', display: 'block', marginBottom: '2px', color: theme.darkgreen, textAlign: "right" }}>שעת התחלה</label>
            <input
              type="time"
              value={replacementForm.startTime || ''}
              onChange={(e) => handleTimeChange(e, 'startTime')}
              placeholder="שעה התחלה (רשות)"
              style={{ width: '100%', padding: '6px', boxSizing: 'border-box', borderRadius: "15px", backgroundColor: theme.backgroundcolor, border: `1px solid ${theme.darkgreen}`, color: theme.darkgreen }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: '15px', display: 'block', marginBottom: '2px', color: theme.darkgreen, textAlign: "right" }}>שעת סיום</label>
            <input
              type="time"
              value={replacementForm.endTime || ''}
              onChange={(e) => handleTimeChange(e, 'endTime')}
              placeholder="שעה סיום (רשות)"
              style={{ width: '100%', padding: '6px', boxSizing: 'border-box', borderRadius: "15px", backgroundColor: theme.backgroundcolor, border: `1px solid ${theme.darkgreen}`, color: theme.darkgreen }}
            />
          </div>
        </div>

        <button
          onClick={async () => {
            if (!replacementForm.startDate || !replacementForm.endDate) {
              alert("חובה לבחור תאריך התחלה וסיום");
              return;
            }

            const url = replacementData.id
              ? `${API_BASE}/api/shift-exemptions/${replacementData.id}`
              : `${API_BASE}/api/shift-exemptions`;

            const method = replacementData.id ? 'PUT' : 'POST';

            try {
              const response = await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  shift_id: editingShiftId,
                  start_date: replacementForm.startDate,
                  end_date: replacementForm.endDate,
                  type: replacementForm.type,
                  start_time: replacementForm.startTime || null,
                  end_time: replacementForm.endTime || null
                })
              });

              if (!response.ok) throw new Error("שגיאה בשמירת ההחלפה");

              alert(replacementData.id ? "ההחלפה עודכנה בהצלחה!" : "ההחלפה נוצרה בהצלחה!");

              setIsReplacementModalOpen(false);
              setReplacementForm({ type: 'pet', startDate: '', endDate: '', startTime: '', endTime: '' });
              setReplacementData({ shift_id: '', start_date: '', end_date: '', type: 'pet' });
              fetchShiftExemptions();
            } catch (err) {
              console.error(err);
              alert("קרתה שגיאה, נסי שוב");
            }
          }}
          style={{
            flex: 1,
            padding: '12px',
            background: theme.pink,
            color: theme.darkgreen,
            marginTop: "10px",
            border: 'none',
            borderRadius: '5px',
            cursor: 'pointer',
            fontWeight: 'bold',
            fontSize: '15px'
          }}
        >
          {replacementData.id ? 'עדכן החלפה' : 'שמור החלפה'}
        </button>
      </div>
    </div>
  )
}

{/* מסך דוח השוואה מפורט */ }
{
  currentScreen === 'dashboard' && (
    <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: theme.backgroundcolor, zIndex: 9999, padding: '40px', overflowY: 'auto', direction: 'rtl', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ color: theme.darkgreen, margin: 0 }}>טבלת השוואה - דוח מפורט</h1>
        <button onClick={() => setCurrentScreen('calendar')} style={{ padding: '8px 16px', fontSize: "17px", background: theme.pink, color: theme.darkgreen, border: `1px solid ${theme.darkgreen}`, borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}>חזרה ללוח</button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', width: "220px", gap: '10px', padding: '15px 0', borderRadius: '12px', marginBottom: "10px" }}>
        <label style={{ fontSize: '15px', fontWeight: 'bold', color: theme.darkgreen }}>תקופה:</label>
        <select
          value={displayedPeriodStr}
          onChange={(e) => {
            const selectedPeriodName = e.target.value;
            const found = customPeriods.find(p => p.name === selectedPeriodName);
            if (found && found.startDate) {
              setStatsDate(new Date(`${found.startDate}T00:00:00`));
            } else {
              const [half, year] = selectedPeriodName.split('.');
              const month = half === '1' ? 0 : 6;
              setStatsDate(new Date(2000 + parseInt(year, 10), month, 1));
            }
          }}
          style={{ padding: '6px 10px', borderRadius: '8px', border: `1px solid ${theme.darkgreen}`, backgroundColor: theme.backgroundcolor, color: theme.darkgreen, fontWeight: 'bold', cursor: 'pointer' }}
        >
          {customPeriods.map(period => (
            <option key={period.name} value={period.name}>תקופה {period.name}</option>
          ))}
        </select>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', background: theme.backgroundcolor, border: `2px solid ${theme.darkgreen}`, borderRadius: "30px" }}>
        <thead>
          <tr style={{ background: theme.darkgreen, color: theme.backgroundcolor }}>
            <th style={{ padding: '10px' }}>שם החייל</th>
            <th style={{ padding: '10px' }}>נקודות נטו</th>
            <th style={{ padding: '10px' }}>שבתות</th>
            <th style={{ padding: '10px' }}>שוש</th>
            <th style={{ padding: '10px' }}>מקוצרת</th>
            <th style={{ padding: '10px' }}>בלת"מים</th>
            {shiftTypes.map(type => (
              <th key={type.id} style={{ padding: '10px' }}>{type.name}</th>
            ))}
            <th style={{ padding: '10px' }}>פירוט חגים</th>
          </tr>
        </thead>
        <tbody>
          {users.filter(u => u.is_active === 1 && (u.does_shifts === 1 || u.does_shifts === null)).map(user => {
            const userStats = getNetStats(user.id, displayedPeriodShifts, shiftTypes);
            const userShifts = displayedPeriodShifts.filter(s => String(s.userId) === String(user.id));
            const balatamsCount = userShifts.filter(s => s.isBaltam).length;

            return (
              <tr key={user.id} style={{ borderBottom: `2px solid ${theme.darkgreen}`, textAlign: 'center' }}>
                <td style={{ padding: '10px', border: `1px solid ${theme.darkgreen}` }}>{user.full_name}</td>
                <td style={{ padding: '10px', fontWeight: 'bold', border: `1px solid ${theme.darkgreen}` }}>{userStats.netPoints}</td>
                <td style={{ padding: '10px', border: `1px solid ${theme.darkgreen}` }}>{userStats.netShabbats}</td>
                <td style={{ padding: '10px', border: `1px solid ${theme.darkgreen}` }}>{userStats.shosh}</td>
                <td style={{ padding: '10px', border: `1px solid ${theme.darkgreen}` }}>{userStats.mkutzarot}</td>
                <td style={{ padding: '10px', color: theme.darkgreen, border: `1px solid ${theme.darkgreen}` }}>{balatamsCount}</td>

                {shiftTypes.map(type => {
                  const count = userShifts.filter(s => String(s.shiftTypeId) === String(type.id)).length;
                  return <td key={type.id} style={{ padding: '10px', border: `1px solid ${theme.darkgreen}` }}>{count}</td>;
                })}

                <td style={{ padding: '10px', fontSize: '15px', border: `1px solid ${theme.darkgreen}` }}>
                  {(() => {
                    const holidays = userShifts.filter(s => s.isHoliday && s.holidayName).map(s => s.holidayName);
                    const uniqueHolidays = [...new Set(holidays)];
                    return uniqueHolidays.length > 0 ? uniqueHolidays.join(', ') : 'אין';
                  })()}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  )
}
    </div >
  );
}

export default App;
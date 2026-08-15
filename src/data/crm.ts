export type LeadStatus = "New" | "Callback" | "Follow Up" | "Site Visit" | "Booked" | "Dropped";

export type Lead = {
  id: string;
  name: string;
  phone: string;
  email: string;
  assigned: string;
  source: string;
  subSource: string;
  status: LeadStatus;
  subStatus: string;
  project: string;
  budget: string;
  requirement: string;
  city: string;
  createdAt: string;
  nextAction: string;
  untouched?: boolean;
  notes: { at: string; by: string; text: string }[];
  history: { at: string; by: string; action: string }[];
};

const agents = [
  "Rupali Vadvkar",
  "Jatin Thakkar",
  "Shital Shinde",
  "Harshada Jadhav",
  "Mohit Mankar",
  "Komal Daund",
];

const sources: [string, string][] = [
  ["Facebook", "investment-text only-creative"],
  ["Facebook", "creative 9-premium 2bhk"],
  ["Google Ads", "google adwords"],
  ["99 Acres", "premium listing"],
  ["Walk In", "site office"],
  ["Referral", "existing customer"],
  ["Website", "contact form"],
  ["IVR", "inbound call"],
];

const projects = [
  "One Residency",
  "Synergy",
  "Aloha",
  "Pavilion",
  "Retail Hub",
  "Aamor",
  "Vari Heights",
];

const names = [
  "Bacharam Patil",
  "Navnath Jare",
  "Rushi Deshmukh",
  "Shubham Ghadage",
  "Pranjal Suryawanshi",
  "Prashant Mete",
  "Lalasaheb Suryawanshi",
  "Mahesh Dole",
  "Amit Kulkarni",
  "Niranjan Rote",
  "Sudhakar Manchadallu",
  "Rohan Kavediya",
  "Rahul Mutha",
  "Akhtar Shaikh",
  "Pallavi Chordia",
  "Neha Bidgar",
  "Kalpesh Bhadane",
  "Anil Jadhav",
  "Anant Kale",
  "Chandrashekhar Suwarnkar",
  "Ghanshyam Thombare",
  "Pankaj Merisha",
  "Rahul Patil",
  "Sneha Kulkarni",
  "Vikram Rane",
  "Priya Nair",
  "Aditya Joshi",
  "Manisha Pawar",
  "Sagar Bhosale",
  "Kiran Salunke",
  "Deepak Chavan",
  "Rutuja More",
  "Omkar Shinde",
  "Tejas Gaikwad",
  "Ashwini Kadam",
  "Nilesh Waghmare",
];

const statuses: { status: LeadStatus; sub: string }[] = [
  { status: "Callback", sub: "not responding" },
  { status: "Follow Up", sub: "interested, budget check" },
  { status: "New", sub: "awaiting first call" },
  { status: "Site Visit", sub: "visit scheduled" },
  { status: "Booked", sub: "token received" },
  { status: "Dropped", sub: "property not matching" },
  { status: "Dropped", sub: "bulk disqualification" },
  { status: "Follow Up", sub: "shared brochure" },
];

const budgets = ["45L - 60L", "60L - 80L", "80L - 1.1Cr", "1.1Cr - 1.5Cr", "1.5Cr +"];
const requirements = ["1 BHK", "2 BHK", "3 BHK", "4 BHK", "Shop / Retail", "Plot"];
const cities = ["Pune", "Mumbai", "Nashik", "Nagpur", "Thane"];

export const leadBudgets = budgets;
export const leadRequirements = requirements;
export const leadCities = cities;
export const leadSourceNames = Array.from(new Set(sources.map(([s]) => s)));
export const leadProjectNames = projects;

function pad(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}

export const leads: Lead[] = Array.from({ length: 36 }, (_, i) => {
  const [source, subSource] = sources[i % sources.length]!;
  const st = statuses[i % statuses.length]!;
  const day = ((i * 3) % 27) + 1;
  return {
    id: `LD-${1000 + i}`,
    name: names[i % names.length]!,
    phone: `+91 9${(403463515 + i * 8117).toString().slice(0, 9)}`,
    email: `${names[i % names.length]!.split(" ")[0]!.toLowerCase()}${i}@gmail.com`,
    assigned: agents[i % agents.length]!,
    source,
    subSource,
    status: st.status,
    subStatus: st.sub,
    project: projects[i % projects.length]!,
    budget: budgets[i % budgets.length]!,
    requirement: requirements[i % requirements.length]!,
    city: cities[i % cities.length]!,
    createdAt: `${pad(day)}-07-2026`,
    nextAction: `${pad(((i * 5) % 27) + 1)} Aug, 2026 | 0${(i % 9) + 1}:30 PM`,
    untouched: i % 5 === 0,
    notes: [
      {
        at: `${pad(day)}-07-2026 04:12 PM`,
        by: agents[i % agents.length]!,
        text: "Called the lead, asked to connect after 6 PM. Interested in a corner unit.",
      },
      {
        at: `${pad(day)}-07-2026 11:02 AM`,
        by: "System",
        text: `Lead auto-assigned from ${source} campaign.`,
      },
    ],
    history: [
      {
        at: `${pad(day)}-07-2026 04:15 PM`,
        by: agents[i % agents.length]!,
        action: `Status changed to ${st.status}`,
      },
      {
        at: `${pad(day)}-07-2026 02:40 PM`,
        by: agents[i % agents.length]!,
        action: "Outgoing call — 2m 14s",
      },
      { at: `${pad(day)}-07-2026 11:02 AM`, by: "System", action: "Lead created" },
    ],
  };
});

export const statusTone: Record<LeadStatus, string> = {
  New: "text-info",
  Callback: "text-warning",
  "Follow Up": "text-info",
  "Site Visit": "text-primary",
  Booked: "text-success",
  Dropped: "text-destructive",
};

export const dashboardStats = [
  { label: "Total Leads", value: "12,271" },
  { label: "Active", value: "473" },
  { label: "Unassigned", value: "5" },
  { label: "Deleted", value: "0" },
  { label: "Booked", value: "1" },
  { label: "Booking Cancel", value: "0" },
  { label: "Not Interested", value: "0" },
  { label: "Dropped", value: "11,792" },
];

export const activityTiles = [
  { label: "New", value: 0, icon: "plus" as const },
  { label: "Pending", value: 4, icon: "clock" as const },
  { label: "Callbacks", value: 0, icon: "phone" as const },
  { label: "Meetings Scheduled", value: 0, icon: "briefcase" as const },
  { label: "Site Visits Scheduled", value: 0, icon: "map" as const },
  { label: "Overdue", value: 1, icon: "alarm" as const },
  { label: "Expression Of Interest", value: 468, icon: "sparkles" as const },
];

export const leadSources = {
  "Social Profiles": [
    { name: "Facebook", count: 6775, tint: "oklch(0.62 0.14 260)" },
    { name: "LinkedIn", count: 0, tint: "oklch(0.6 0.12 240)" },
    { name: "Google Ads", count: 782, tint: "oklch(0.72 0.15 55)" },
    { name: "Gmail", count: 2, tint: "oklch(0.65 0.18 25)" },
    { name: "WhatsApp", count: 0, tint: "oklch(0.7 0.15 150)" },
    { name: "YouTube", count: 0, tint: "oklch(0.62 0.2 22)" },
  ],
  "3rd Parties": [
    { name: "IVR", count: 7, tint: "oklch(0.62 0.15 300)" },
    { name: "Magic Bricks", count: 0, tint: "oklch(0.62 0.19 15)" },
    { name: "99 Acres", count: 476, tint: "oklch(0.6 0.14 250)" },
    { name: "Housing.com", count: 0, tint: "oklch(0.75 0.15 70)" },
    { name: "QuikrHomes", count: 0, tint: "oklch(0.65 0.15 150)" },
    { name: "OLX", count: 0, tint: "oklch(0.6 0.11 200)" },
  ],
  Others: [
    { name: "Direct", count: 0, tint: "oklch(0.55 0.02 260)" },
    { name: "Referral", count: 224, tint: "oklch(0.68 0.11 178)" },
    { name: "Walk In", count: 1134, tint: "oklch(0.6 0.13 195)" },
    { name: "Website", count: 172, tint: "oklch(0.65 0.14 180)" },
    { name: "Microsite", count: 0, tint: "oklch(0.62 0.1 210)" },
    { name: "Phonebook", count: 0, tint: "oklch(0.6 0.12 230)" },
  ],
};

export const leadTrend = [
  { week: "W1", facebook: 320, google: 120, portals: 90, walkin: 60 },
  { week: "W2", facebook: 780, google: 210, portals: 160, walkin: 95 },
  { week: "W3", facebook: 1980, google: 340, portals: 220, walkin: 120 },
  { week: "W4", facebook: 1240, google: 260, portals: 310, walkin: 140 },
  { week: "W5", facebook: 640, google: 180, portals: 190, walkin: 88 },
  { week: "W6", facebook: 910, google: 420, portals: 240, walkin: 130 },
  { week: "W7", facebook: 460, google: 300, portals: 150, walkin: 105 },
  { week: "W8", facebook: 720, google: 380, portals: 280, walkin: 160 },
];

export const funnel = [
  { stage: "Leads", value: 12271 },
  { stage: "Contacted", value: 6840 },
  { stage: "Qualified", value: 2410 },
  { stage: "Site Visits", value: 890 },
  { stage: "Negotiation", value: 260 },
  { stage: "Booked", value: 74 },
];

export type Project = {
  id: string;
  name: string;
  city: string;
  type: "Residential" | "Commercial" | "Agricultural";
  dataCount: number;
  matching: number;
  available: boolean;
  price: string;
  units: string;
};

export const projectList: Project[] = [
  {
    id: "P-01",
    name: "One Residency",
    city: "Pune",
    type: "Residential",
    dataCount: 4,
    matching: 18,
    available: true,
    price: "₹ 78L onwards",
    units: "2 & 3 BHK",
  },
  {
    id: "P-02",
    name: "Mandate Towers",
    city: "Mumbai",
    type: "Residential",
    dataCount: 0,
    matching: 6,
    available: true,
    price: "₹ 1.4Cr onwards",
    units: "3 BHK",
  },
  {
    id: "P-03",
    name: "Vari Properties LLP",
    city: "Pune",
    type: "Commercial",
    dataCount: 0,
    matching: 2,
    available: true,
    price: "₹ 92L onwards",
    units: "Office",
  },
  {
    id: "P-04",
    name: "Project Alpha",
    city: "Nashik",
    type: "Residential",
    dataCount: 0,
    matching: 9,
    available: false,
    price: "₹ 52L onwards",
    units: "1 & 2 BHK",
  },
  {
    id: "P-05",
    name: "Aamor",
    city: "Pune",
    type: "Residential",
    dataCount: 0,
    matching: 12,
    available: true,
    price: "₹ 66L onwards",
    units: "2 BHK",
  },
  {
    id: "P-06",
    name: "Synergy",
    city: "Thane",
    type: "Commercial",
    dataCount: 3,
    matching: 21,
    available: true,
    price: "₹ 1.1Cr onwards",
    units: "Retail",
  },
  {
    id: "P-07",
    name: "Aloha",
    city: "Pune",
    type: "Residential",
    dataCount: 1,
    matching: 15,
    available: true,
    price: "₹ 84L onwards",
    units: "3 BHK",
  },
  {
    id: "P-08",
    name: "Pavilion",
    city: "Nagpur",
    type: "Residential",
    dataCount: 0,
    matching: 4,
    available: false,
    price: "₹ 48L onwards",
    units: "1 BHK",
  },
  {
    id: "P-09",
    name: "Green Acres",
    city: "Pune",
    type: "Agricultural",
    dataCount: 0,
    matching: 1,
    available: true,
    price: "₹ 22L / acre",
    units: "Plots",
  },
  {
    id: "P-10",
    name: "Retail Hub",
    city: "Mumbai",
    type: "Commercial",
    dataCount: 2,
    matching: 7,
    available: true,
    price: "₹ 2.2Cr onwards",
    units: "Showroom",
  },
];

export type AgentReport = {
  user: string;
  workingHours: string;
  calls: number;
  uniqueCalls: number;
  whatsapp: number;
  email: number;
  sms: number;
  statusEdits: number;
  formEdits: number;
  notes: number;
  active: boolean;
};

export const agentReports: AgentReport[] = [
  {
    user: "Archana Sarwade",
    workingHours: "07:42",
    calls: 5,
    uniqueCalls: 5,
    whatsapp: 2,
    email: 0,
    sms: 0,
    statusEdits: 11,
    formEdits: 3,
    notes: 18,
    active: true,
  },
  {
    user: "Bhushan Supekar",
    workingHours: "08:15",
    calls: 20,
    uniqueCalls: 13,
    whatsapp: 6,
    email: 1,
    sms: 0,
    statusEdits: 13,
    formEdits: 6,
    notes: 20,
    active: true,
  },
  {
    user: "Haina Parde",
    workingHours: "03:20",
    calls: 0,
    uniqueCalls: 0,
    whatsapp: 0,
    email: 0,
    sms: 0,
    statusEdits: 0,
    formEdits: 1,
    notes: 0,
    active: false,
  },
  {
    user: "Harshada Jadhav",
    workingHours: "08:48",
    calls: 18,
    uniqueCalls: 13,
    whatsapp: 4,
    email: 2,
    sms: 1,
    statusEdits: 27,
    formEdits: 1,
    notes: 33,
    active: true,
  },
  {
    user: "Ishvar Dhanegave",
    workingHours: "09:05",
    calls: 21,
    uniqueCalls: 19,
    whatsapp: 9,
    email: 0,
    sms: 0,
    statusEdits: 10,
    formEdits: 29,
    notes: 25,
    active: true,
  },
  {
    user: "Jatin Thakkar",
    workingHours: "06:30",
    calls: 0,
    uniqueCalls: 0,
    whatsapp: 0,
    email: 0,
    sms: 0,
    statusEdits: 0,
    formEdits: 0,
    notes: 0,
    active: true,
  },
  {
    user: "Komal Daund",
    workingHours: "07:10",
    calls: 3,
    uniqueCalls: 3,
    whatsapp: 1,
    email: 0,
    sms: 0,
    statusEdits: 8,
    formEdits: 2,
    notes: 14,
    active: true,
  },
  {
    user: "Mohit Mankar",
    workingHours: "08:02",
    calls: 14,
    uniqueCalls: 13,
    whatsapp: 5,
    email: 0,
    sms: 0,
    statusEdits: 8,
    formEdits: 11,
    notes: 27,
    active: true,
  },
  {
    user: "Mohit Tiwari",
    workingHours: "02:15",
    calls: 0,
    uniqueCalls: 0,
    whatsapp: 0,
    email: 0,
    sms: 0,
    statusEdits: 0,
    formEdits: 0,
    notes: 0,
    active: false,
  },
  {
    user: "Rupali Vadvkar",
    workingHours: "08:36",
    calls: 26,
    uniqueCalls: 22,
    whatsapp: 11,
    email: 3,
    sms: 0,
    statusEdits: 19,
    formEdits: 8,
    notes: 41,
    active: true,
  },
  {
    user: "Shital Shinde",
    workingHours: "07:55",
    calls: 12,
    uniqueCalls: 10,
    whatsapp: 3,
    email: 1,
    sms: 0,
    statusEdits: 14,
    formEdits: 4,
    notes: 22,
    active: true,
  },
  {
    user: "Sneha Patil",
    workingHours: "05:44",
    calls: 7,
    uniqueCalls: 6,
    whatsapp: 2,
    email: 0,
    sms: 0,
    statusEdits: 5,
    formEdits: 2,
    notes: 9,
    active: false,
  },
];

export type TeamRole = "Admin" | "Manager" | "Team Lead" | "Agent";

export type TeamMember = {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: TeamRole;
  team: string;
  isActive: boolean;
  joinedAt: string;
  leadsHandled: number;
};

export const teams = ["Alpha Team", "Beta Team", "Gamma Team"];

export const teamMembers: TeamMember[] = [
  {
    id: "TM-01",
    name: "Jatin Thakkar",
    email: "jatin.thakkar@estatly.crm",
    phone: "+91 98765 10001",
    role: "Admin",
    team: "Alpha Team",
    isActive: true,
    joinedAt: "12-01-2025",
    leadsHandled: 612,
  },
  {
    id: "TM-02",
    name: "Rupali Vadvkar",
    email: "rupali.vadvkar@estatly.crm",
    phone: "+91 98765 10002",
    role: "Team Lead",
    team: "Alpha Team",
    isActive: true,
    joinedAt: "03-02-2025",
    leadsHandled: 1240,
  },
  {
    id: "TM-03",
    name: "Shital Shinde",
    email: "shital.shinde@estatly.crm",
    phone: "+91 98765 10003",
    role: "Agent",
    team: "Alpha Team",
    isActive: true,
    joinedAt: "18-02-2025",
    leadsHandled: 845,
  },
  {
    id: "TM-04",
    name: "Harshada Jadhav",
    email: "harshada.jadhav@estatly.crm",
    phone: "+91 98765 10004",
    role: "Agent",
    team: "Alpha Team",
    isActive: true,
    joinedAt: "22-02-2025",
    leadsHandled: 918,
  },
  {
    id: "TM-05",
    name: "Priya Nair",
    email: "priya.nair@estatly.crm",
    phone: "+91 98765 10005",
    role: "Agent",
    team: "Alpha Team",
    isActive: true,
    joinedAt: "05-03-2025",
    leadsHandled: 733,
  },
  {
    id: "TM-06",
    name: "Mohit Mankar",
    email: "mohit.mankar@estatly.crm",
    phone: "+91 98765 10006",
    role: "Team Lead",
    team: "Beta Team",
    isActive: true,
    joinedAt: "10-01-2025",
    leadsHandled: 1102,
  },
  {
    id: "TM-07",
    name: "Komal Daund",
    email: "komal.daund@estatly.crm",
    phone: "+91 98765 10007",
    role: "Agent",
    team: "Beta Team",
    isActive: true,
    joinedAt: "14-02-2025",
    leadsHandled: 690,
  },
  {
    id: "TM-08",
    name: "Archana Sarwade",
    email: "archana.sarwade@estatly.crm",
    phone: "+91 98765 10008",
    role: "Agent",
    team: "Beta Team",
    isActive: true,
    joinedAt: "19-02-2025",
    leadsHandled: 588,
  },
  {
    id: "TM-09",
    name: "Bhushan Supekar",
    email: "bhushan.supekar@estatly.crm",
    phone: "+91 98765 10009",
    role: "Agent",
    team: "Beta Team",
    isActive: true,
    joinedAt: "27-02-2025",
    leadsHandled: 764,
  },
  {
    id: "TM-10",
    name: "Haina Parde",
    email: "haina.parde@estatly.crm",
    phone: "+91 98765 10010",
    role: "Agent",
    team: "Beta Team",
    isActive: false,
    joinedAt: "02-03-2025",
    leadsHandled: 214,
  },
  {
    id: "TM-11",
    name: "Ishvar Dhanegave",
    email: "ishvar.dhanegave@estatly.crm",
    phone: "+91 98765 10011",
    role: "Team Lead",
    team: "Gamma Team",
    isActive: true,
    joinedAt: "08-01-2025",
    leadsHandled: 1315,
  },
  {
    id: "TM-12",
    name: "Sneha Patil",
    email: "sneha.patil@estatly.crm",
    phone: "+91 98765 10012",
    role: "Agent",
    team: "Gamma Team",
    isActive: true,
    joinedAt: "16-02-2025",
    leadsHandled: 502,
  },
  {
    id: "TM-13",
    name: "Vikram Rane",
    email: "vikram.rane@estatly.crm",
    phone: "+91 98765 10013",
    role: "Agent",
    team: "Gamma Team",
    isActive: true,
    joinedAt: "21-02-2025",
    leadsHandled: 671,
  },
  {
    id: "TM-14",
    name: "Mohit Tiwari",
    email: "mohit.tiwari@estatly.crm",
    phone: "+91 98765 10014",
    role: "Agent",
    team: "Gamma Team",
    isActive: false,
    joinedAt: "01-03-2025",
    leadsHandled: 189,
  },
  {
    id: "TM-15",
    name: "Aditya Joshi",
    email: "aditya.joshi@estatly.crm",
    phone: "+91 98765 10015",
    role: "Agent",
    team: "Beta Team",
    isActive: true,
    joinedAt: "11-03-2025",
    leadsHandled: 447,
  },
];

export const currentUser: TeamMember = teamMembers[0]!;

export const moduleSettings = [
  { title: "General", desc: "Common platform configuration", icon: "settings" as const },
  { title: "Security", desc: "2FA security settings can be done", icon: "shield" as const },
  { title: "Attendance", desc: "Manage your shift timings", icon: "calendar" as const },
  { title: "Leads", desc: "Customized lead features", icon: "users" as const },
  { title: "Data", desc: "Customized data features", icon: "database" as const },
  {
    title: "Projects and Properties",
    desc: "Customized property & project features",
    icon: "building" as const,
  },
  { title: "Locality", desc: "Customized locality feature", icon: "map" as const },
  { title: "QR Code", desc: "Customize the QR enquiry form", icon: "qr" as const },
  { title: "Tags", desc: "Customized tags", icon: "tag" as const },
  { title: "Manage Marketing", desc: "Customized marketing efforts", icon: "megaphone" as const },
  { title: "Migration", desc: "Migrate Leads/Data", icon: "arrows" as const },
  { title: "Automation", desc: "Automate the setting", icon: "zap" as const },
];

export const integrations = {
  "3rd Parties": [
    "99 Acres",
    "Estate Dekho",
    "Flipkart",
    "Housing",
    "Magic Bricks",
    "MyGate",
    "Property Wala",
    "Quikr Homes",
    "Real Estate India",
    "Roofandfloor",
    "Webhook",
    "Common Floor",
  ],
  "Social Platforms": [
    "Gmail",
    "Google Ads Landing",
    "Google Ads Leads Form",
    "Google Campaign",
    "Microsoft Ads",
    "Whatsapp",
    "Facebook",
    "Instagram",
  ],
  Others: ["Templates", "IVR Caller System", "Email Configuration", "SMS Gateway"],
};

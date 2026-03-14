export type Technician = {
  id: number;
  name: string;
  email?: string;
  phone?: string;
  color: string;
  skills: string;
  isActive: boolean;
};

export type TeamMember = {
  id: number;
  name: string;
  color: string;
  isActive: boolean;
};

export type Team = {
  id: number;
  name: string;
  color: string;
  memberIds: number[];
  members: TeamMember[];
  memberCount: number;
  isActive: boolean;
  capacityPerDay?: number | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type UserRoleValue = 'ADMIN' | 'DISPATCHER' | 'TECHNICIAN';

export type ManagedUser = {
  id: number;
  name: string;
  username?: string | null;
  email?: string | null;
  role: UserRoleValue;
  isActive: boolean;
  technicianId?: number | null;
  createdAt: string;
  updatedAt: string;
};

export type InterventionStatus = 'TO_DO' | 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'NO_SHOW';
export type InterventionPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export type CustomerType = 'PRIVATO' | 'AZIENDA';
export type PreferredTimeSlot = 'MATTINA' | 'PRANZO' | 'POMERIGGIO' | 'SERA' | 'INDIFFERENTE';
export type AttachmentKind = 'AUDIO' | 'IMAGE' | 'FILE';

export type AttachmentRecord = {
  id: string;
  kind: AttachmentKind;
  mimeType: string;
  originalName: string;
  size: number;
  createdAt: string;
  downloadUrl?: string;
};

export type Intervention = {
  id: number;
  version: number;
  title: string;
  description?: string;
  address: string;
  status: InterventionStatus;
  priority: InterventionPriority;
  startAt?: string; // ISO
  endAt?: string;   // ISO
  technicianId?: number;
  technician?: Technician;

  secondaryTechnicianId?: number;
  secondaryTechnician?: Technician;

  customerId?: string;
  customer?: Customer;
  customerNameSnapshot?: string;
  customerEmailSnapshot?: string;
  customerPhoneSnapshot?: string;
  customerAddressSnapshot?: string;

  createdAt: string;
  updatedAt: string;
  media?: Media[];
  workReport?: WorkReport;
  attachments?: AttachmentRecord[];
};

export type Customer = {
  id: string;
  companyName?: string;
  customerType?: CustomerType;
  preferredTimeSlot?: PreferredTimeSlot;
  name: string;
  email?: string;
  phone1?: string;
  phone2?: string;
  phone?: string;
  taxCode?: string;
  vatNumber?: string;
  addressLine?: string;
  physicalAddress?: string;
  intercomInfo?: string;
  intercomLabel?: string;
  city?: string;
  notes?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CreateInterventionInitialData = {
  jobId?: string;
  customerId?: string;
  customer?: Customer | null;
  address?: string;
  customerNameSnapshot?: string;
  customerEmailSnapshot?: string;
  customerPhoneSnapshot?: string;
  customerAddressSnapshot?: string;
};

export type Site = {
  id: string;
  customerId: string;
  label?: string | null;
  address: string;
  startDate?: string | null;
  endDate?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type JobStatus = 'OPEN' | 'PAUSED' | 'CLOSED' | 'ARCHIVED';

export type Job = {
  id: string;
  siteId: string;
  code?: string | null;
  title: string;
  description?: string | null;
  status: JobStatus;
  startDate?: string | null;
  endDate?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WorkReport = {
  id: string;
  reportNumber: number;
  interventionId: number;
  version?: number;
  actualStartAt?: string;
  actualEndAt?: string;
  actualMinutes: number;
  pausedMinutes?: number;
  pauseStartAt?: string;
  workPerformed: string;
  extraWork?: string;
  materials?: string;
  customerName?: string;
  customerEmail?: string;
  signatureToken?: string;
  signatureRequestedAt?: string;
  customerSignatureDataUrl?: string; // base64
  signedAt?: string;
  emailedAt?: string;
  attachments?: AttachmentRecord[];
  createdAt: string;
  updatedAt: string;
};

export type InterventionDetails = {
  id: number;
  title: string;
  description?: string;
  address: string;
  status: InterventionStatus;
  priority: InterventionPriority;
  startAt?: string;
  endAt?: string;
  technicianId?: number | null;
  secondaryTechnicianId?: number | null;
  customerId?: string | null;
  customerNameSnapshot?: string | null;
  customerEmailSnapshot?: string | null;
  customerPhoneSnapshot?: string | null;
  customerAddressSnapshot?: string | null;
  customer?: Customer | null;
  attachments: AttachmentRecord[];
  workReport?: (WorkReport & { attachments?: AttachmentRecord[] }) | null;
};

export type Media = {
  id: number;
  url: string;
  type: 'image' | 'video';
  interventionId: number;
  createdAt: string;
};

export type StatsKpis = {
  plannedInterventions: number;
  completedInterventions: number;
  completionRate: number;
  backlogCurrent: number;
  plannerConflicts: number;
  totalWorkedMinutes: number;
  workReportCompiled: number;
  workReportMissing: number;
};

export type StatsTopCustomer = {
  name: string;
  count: number;
};

export type StatsTeamLoad = {
  teamId: number;
  teamName: string;
  interventions: number;
  workedMinutes: number;
};

export type StatsStatusCount = {
  status: string;
  count: number;
};

export type StatsOverview = {
  range: {
    from: string;
    to: string;
  };
  selectedTeamIds: number[];
  kpis: StatsKpis;
  topCustomers: StatsTopCustomer[];
  loadByTeam: StatsTeamLoad[];
  statusCounts: StatsStatusCount[];
};

import { useState, useEffect, useRef } from 'react';
import { Customer, Site, Job, JobStatus, Technician, CreateInterventionInitialData } from '../types';
import { Plus, Building2, User, Phone, Mail, MapPin, X, Copy } from 'lucide-react';
import { apiFetch } from '../lib/apiFetch';
import CreateInterventionModal from '../components/CreateInterventionModal';
import AppLayout from '../components/AppLayout';
import { useModalRegistration } from '../components/ModalStackProvider';
import { toast } from '../components/Toast';
import { copyTextToClipboard, sanitizePhoneForCopy } from '../lib/clipboard';

const preferredTimeSlotOptions = ['MATTINA', 'PRANZO', 'POMERIGGIO', 'SERA', 'INDIFFERENTE'] as const;
const jobStatusOptions: JobStatus[] = ['OPEN', 'PAUSED', 'CLOSED', 'ARCHIVED'];
type CustomerTypeFilter = 'ALL' | 'PRIVATE' | 'COMPANY';
const customerRowGridClasses = 'grid grid-cols-1 lg:grid-cols-[minmax(250px,1.3fr)_minmax(140px,0.7fr)_minmax(300px,1.5fr)_minmax(340px,1.7fr)_minmax(160px,0.8fr)_minmax(110px,0.5fr)] gap-2 lg:gap-4';

function sanitizePhoneForTel(phone?: string | null) {
    if (!phone) return '';
    return phone.replace(/[^\d+]/g, '');
}

async function copyPhoneWithToast(phone?: string | null) {
    const sanitized = sanitizePhoneForCopy(phone || '');
    if (!sanitized) {
        toast.info('Nessun numero da copiare');
        return;
    }
    const copied = await copyTextToClipboard(sanitized);
    if (copied) {
        toast.success('Numero copiato');
    } else {
        toast.error('Impossibile copiare il numero');
    }
}

function formatSiteDate(value?: string | null) {
    if (!value) return '';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleDateString('it-IT');
}

function formatSiteDateRange(site: Site) {
    const from = formatSiteDate(site.startDate);
    const to = formatSiteDate(site.endDate);
    if (from && to) return `${from} - ${to}`;
    if (from) return `Dal ${from}`;
    if (to) return `Fino al ${to}`;
    return '';
}

function getJobStatusBadgeClasses(status: JobStatus) {
    switch (status) {
        case 'OPEN':
            return 'bg-emerald-50 text-emerald-700 border-emerald-200';
        case 'PAUSED':
            return 'bg-amber-50 text-amber-700 border-amber-200';
        case 'CLOSED':
            return 'bg-slate-100 text-slate-600 border-slate-200';
        case 'ARCHIVED':
            return 'bg-slate-50 text-slate-500 border-slate-200';
        default:
            return 'bg-slate-50 text-slate-500 border-slate-200';
    }
}

function getProvinceSigla(customer: Customer) {
    const extended = customer as Customer & { province?: string | null; provinceCode?: string | null };
    const rawProvince = (extended.provinceCode || extended.province || '').trim();
    if (rawProvince) return rawProvince.toUpperCase().slice(0, 2);
    const city = (customer.city || '').trim();
    const cityMatch = city.match(/\(([A-Za-z]{2})\)$/);
    if (cityMatch) return cityMatch[1].toUpperCase();
    return '-';
}

export default function CustomersPage() {
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [search, setSearch] = useState('');
    const [typeFilter, setTypeFilter] = useState<CustomerTypeFilter>('ALL');
    const [loading, setLoading] = useState(false);

    const [editingCustomer, setEditingCustomer] = useState<Customer | { isNew: true } | null>(null);
    const [toast, setToast] = useState<{ msg: string, type: 'error' | 'success' } | null>(null);
    const [isCreateInterventionOpen, setIsCreateInterventionOpen] = useState(false);
    const [createInterventionInitialData, setCreateInterventionInitialData] = useState<CreateInterventionInitialData | undefined>(undefined);
    const [technicians, setTechnicians] = useState<Technician[]>([]);

    const fetchCustomers = async (q: string = '') => {
        setLoading(true);
        try {
            const res = await apiFetch(`/api/customers?q=${encodeURIComponent(q)}`);
            const data = await res.json();
            setCustomers(Array.isArray(data) ? data : []);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    // Debounce search
    useEffect(() => {
        const timer = setTimeout(() => {
            fetchCustomers(search);
        }, 250);
        return () => clearTimeout(timer);
    }, [search]);

    const showToast = (msg: string, type: 'error' | 'success') => {
        setToast({ msg, type });
        setTimeout(() => setToast(null), 3000);
    };

    const filteredCustomers = customers
        .filter((customer) => {
            const q = search.trim().toLowerCase();
            if (!q) return true;
            const searchable = [
                customer.name,
                customer.companyName,
                customer.email,
                customer.phone,
                customer.addressLine,
                customer.physicalAddress,
                customer.city,
                customer.intercomLabel,
                customer.intercomInfo,
                customer.notes
            ]
                .filter(Boolean)
                .join(' ')
                .toLowerCase();
            return searchable.includes(q);
        })
        .filter((customer) => {
            if (typeFilter === 'ALL') return true;
            const isCompany = customer.customerType === 'AZIENDA';
            return typeFilter === 'COMPANY' ? isCompany : !isCompany;
        });

    const ensureTechniciansLoaded = async () => {
        if (technicians.length > 0) return;
        try {
            const res = await apiFetch('/api/technicians');
            if (!res.ok) return;
            const data = await res.json().catch(() => []);
            setTechnicians(Array.isArray(data) ? data : []);
        } catch {
            setTechnicians([]);
        }
    };

    const openCreateInterventionForSite = async (customer: Customer, siteAddress: string) => {
        setCreateInterventionInitialData({
            address: siteAddress,
            customerId: customer.id,
            customer,
            customerNameSnapshot: customer.name,
            customerEmailSnapshot: customer.email || undefined,
            customerPhoneSnapshot: customer.phone || undefined,
            customerAddressSnapshot: customer.addressLine || siteAddress
        });
        setIsCreateInterventionOpen(true);
        await ensureTechniciansLoaded();
    };

    const openCreateInterventionForJob = async (job: Job, site: Site, customer: Customer) => {
        setCreateInterventionInitialData({
            jobId: job.id,
            customerId: customer.id,
            customer,
            address: site.address,
            customerNameSnapshot: customer.name,
            customerEmailSnapshot: customer.email || undefined,
            customerPhoneSnapshot: customer.phone || undefined,
            customerAddressSnapshot: customer.addressLine || site.address
        });
        setIsCreateInterventionOpen(true);
        await ensureTechniciansLoaded();
    };

    const closeCreateInterventionModal = () => {
        setIsCreateInterventionOpen(false);
        setCreateInterventionInitialData(undefined);
    };

    useModalRegistration({
        id: 'customers-create-intervention-modal',
        isOpen: isCreateInterventionOpen,
        onClose: closeCreateInterventionModal,
        options: {
            closeOnEsc: true,
            blockEscWhenEditing: true,
            priority: 140
        }
    });

    return (
        <AppLayout
            title="Clienti"
            subtitle="Anagrafica clienti e cantieri"
            searchPlaceholder="Cerca nome, email, telefono..."
            onSearchChange={setSearch}
            contentClassName="max-w-7xl w-full mx-auto space-y-6"
        >
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="inline-flex items-center gap-1 rounded-full border border-white/70 bg-white/70 p-1">
                    <button
                        type="button"
                        onClick={() => setTypeFilter('ALL')}
                        className={`rounded-full px-3 py-1.5 text-[11px] font-semibold transition ${
                            typeFilter === 'ALL'
                                ? 'bg-brand-50 text-brand-700 border border-brand-200'
                                : 'text-slate-600 hover:text-slate-800'
                        }`}
                    >
                        Tutti
                    </button>
                    <button
                        type="button"
                        onClick={() => setTypeFilter('PRIVATE')}
                        className={`rounded-full px-3 py-1.5 text-[11px] font-semibold transition ${
                            typeFilter === 'PRIVATE'
                                ? 'bg-brand-50 text-brand-700 border border-brand-200'
                                : 'text-slate-600 hover:text-slate-800'
                        }`}
                    >
                        Privati
                    </button>
                    <button
                        type="button"
                        onClick={() => setTypeFilter('COMPANY')}
                        className={`rounded-full px-3 py-1.5 text-[11px] font-semibold transition ${
                            typeFilter === 'COMPANY'
                                ? 'bg-brand-50 text-brand-700 border border-brand-200'
                                : 'text-slate-600 hover:text-slate-800'
                        }`}
                    >
                        Aziende
                    </button>
                </div>

                <button
                    onClick={() => setEditingCustomer({ isNew: true })}
                    className="flex items-center gap-2 bg-brand-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-brand-700 transition w-full md:w-auto justify-center"
                >
                    <Plus className="w-4 h-4" />
                    Nuovo Cliente
                </button>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                <div className={`hidden lg:grid ${customerRowGridClasses} px-6 py-3 border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-[0.12em] font-semibold text-slate-500`}>
                    <div>Cliente</div>
                    <div>Tel</div>
                    <div>Email</div>
                    <div>Indirizzo</div>
                    <div>Città</div>
                    <div>Sigla Prov.</div>
                </div>

                <div className="divide-y divide-slate-100">
                    {loading && customers.length === 0 ? (
                        <div className="px-6 py-8 text-center text-slate-500">Ricerca in corso...</div>
                    ) : filteredCustomers.length === 0 ? (
                        <div className="px-6 py-8 text-center text-slate-500">Nessun cliente trovato.</div>
                    ) : filteredCustomers.map((c) => {
                        const displayAddress = c.addressLine || c.physicalAddress || '-';
                        const provinceSigla = getProvinceSigla(c);
                        return (
                            <div
                                key={c.id}
                                role="button"
                                tabIndex={0}
                                onClick={() => setEditingCustomer(c)}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter' || event.key === ' ') {
                                        event.preventDefault();
                                        setEditingCustomer(c);
                                    }
                                }}
                                className={`${customerRowGridClasses} px-4 lg:px-6 py-4 hover:bg-slate-50 transition group cursor-pointer`}
                            >
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                        <div className="font-semibold text-slate-800 truncate">{c.name}</div>
                                        <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${c.customerType === 'AZIENDA' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
                                            {c.customerType || 'PRIVATO'}
                                        </span>
                                    </div>
                                    {c.companyName && <div className="text-xs text-slate-500 flex items-center gap-1 mt-1"><Building2 className="w-3 h-3" /> {c.companyName}</div>}
                                </div>

                                <div className="min-w-0">
                                    <div className="lg:hidden text-[11px] uppercase tracking-[0.1em] text-slate-500 mb-0.5">Tel:</div>
                                    {c.phone ? (
                                        <a
                                            href={`tel:${sanitizePhoneForTel(c.phone)}`}
                                            onClick={(e) => e.stopPropagation()}
                                            className="text-sm text-slate-600 hover:text-emerald-600 underline-offset-2 hover:underline"
                                            title={c.phone}
                                        >
                                            {c.phone}
                                        </a>
                                    ) : (
                                        <span className="text-sm text-slate-400">-</span>
                                    )}
                                </div>

                                <div className="min-w-0">
                                    <div className="lg:hidden text-[11px] uppercase tracking-[0.1em] text-slate-500 mb-0.5">Email:</div>
                                    {c.email ? (
                                        <a
                                            href={`mailto:${c.email}`}
                                            onClick={(e) => e.stopPropagation()}
                                            className="text-sm text-slate-600 hover:text-brand-600 underline-offset-2 hover:underline block truncate"
                                            title={c.email}
                                        >
                                            {c.email}
                                        </a>
                                    ) : (
                                        <span className="text-sm text-slate-400">-</span>
                                    )}
                                </div>

                                <div className="min-w-0">
                                    <div className="lg:hidden text-[11px] uppercase tracking-[0.1em] text-slate-500 mb-0.5">Indirizzo:</div>
                                    <span className="text-sm text-slate-600 block truncate" title={displayAddress}>
                                        {displayAddress}
                                    </span>
                                </div>

                                <div className="min-w-0">
                                    <div className="lg:hidden text-[11px] uppercase tracking-[0.1em] text-slate-500 mb-0.5">Città:</div>
                                    <span className="text-sm text-slate-600 block truncate" title={c.city || '-'}>
                                        {c.city || '-'}
                                    </span>
                                </div>

                                <div className="min-w-0">
                                    <div className="lg:hidden text-[11px] uppercase tracking-[0.1em] text-slate-500 mb-0.5">Sigla Prov.:</div>
                                    <span className="text-sm text-slate-600">{provinceSigla}</span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {editingCustomer && (
                <CustomerModal
                    customer={'isNew' in editingCustomer ? undefined : editingCustomer}
                    onClose={() => setEditingCustomer(null)}
                    onSaved={() => fetchCustomers(search)}
                    onCreateInterventionAtSite={openCreateInterventionForSite}
                    onCreateInterventionAtJob={openCreateInterventionForJob}
                    technicians={technicians}
                />
            )}

            {isCreateInterventionOpen && createInterventionInitialData && (
                <CreateInterventionModal
                    mode="create"
                    initialData={createInterventionInitialData}
                    onClose={closeCreateInterventionModal}
                    onSuccess={() => {
                        closeCreateInterventionModal();
                        showToast('Intervento creato', 'success');
                    }}
                    technicians={technicians}
                />
            )}

            {toast && (
                <div className={`fixed bottom-4 right-4 px-4 py-3 rounded-xl shadow-lg font-medium text-white flex items-center gap-2 animate-in slide-in-from-bottom-5 ${toast.type === 'error' ? 'bg-red-500' : 'bg-emerald-500'} z-50`}>
                    {toast.msg}
                </div>
            )}
        </AppLayout>
    );
}

// ------ MODAL ------
function CustomerModal({
    customer,
    onClose,
    onSaved,
    onCreateInterventionAtSite,
    onCreateInterventionAtJob,
    technicians
}: {
    customer?: Customer,
    onClose: () => void,
    onSaved: () => void,
    onCreateInterventionAtSite: (customer: Customer, siteAddress: string) => void,
    onCreateInterventionAtJob: (job: Job, site: Site, customer: Customer) => void,
    technicians: Technician[]
}) {
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [sites, setSites] = useState<Site[]>([]);
    const [sitesLoading, setSitesLoading] = useState(false);
    const [sitesError, setSitesError] = useState('');
    const [showSiteModal, setShowSiteModal] = useState(false);
    const [siteSubmitting, setSiteSubmitting] = useState(false);
    const [jobsBySite, setJobsBySite] = useState<Record<string, Job[]>>({});
    const [jobsLoadingBySite, setJobsLoadingBySite] = useState<Record<string, boolean>>({});
    const [jobsErrorBySite, setJobsErrorBySite] = useState<Record<string, string>>({});
    const [jobModalState, setJobModalState] = useState<{ siteId: string; job?: Job } | null>(null);
    const [jobSubmitting, setJobSubmitting] = useState(false);
    const [jobError, setJobError] = useState('');
    const [jobInterventionsByJob, setJobInterventionsByJob] = useState<Record<string, any[]>>({});
    const [jobInterventionsLoadingByJob, setJobInterventionsLoadingByJob] = useState<Record<string, boolean>>({});
    const [jobInterventionsErrorByJob, setJobInterventionsErrorByJob] = useState<Record<string, string>>({});
    const [customerTypeValue, setCustomerTypeValue] = useState<'PRIVATO' | 'AZIENDA'>(customer?.customerType || 'PRIVATO');
    const phoneInputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        setCustomerTypeValue(customer?.customerType || 'PRIVATO');
    }, [customer?.customerType]);

    useModalRegistration({
        id: `customers-main-modal-${customer?.id ?? 'new'}`,
        isOpen: true,
        onClose,
        options: {
            closeOnEsc: true,
            blockEscWhenEditing: true,
            priority: 100
        }
    });

    useModalRegistration({
        id: `customers-site-modal-${customer?.id ?? 'new'}`,
        isOpen: showSiteModal,
        onClose: () => setShowSiteModal(false),
        options: {
            closeOnEsc: true,
            blockEscWhenEditing: true,
            priority: 110
        }
    });

    useModalRegistration({
        id: `customers-job-modal-${customer?.id ?? 'new'}`,
        isOpen: Boolean(jobModalState),
        onClose: () => setJobModalState(null),
        options: {
            closeOnEsc: true,
            blockEscWhenEditing: true,
            priority: 120
        }
    });

    const loadJobInterventions = async (jobId: string) => {
        setJobInterventionsLoadingByJob(prev => ({ ...prev, [jobId]: true }));
        setJobInterventionsErrorByJob(prev => ({ ...prev, [jobId]: '' }));
        try {
            const res = await apiFetch(`/api/jobs/${jobId}/interventions`);
            if (!res.ok) throw new Error();
            const data = await res.json().catch(() => []);
            setJobInterventionsByJob(prev => ({ ...prev, [jobId]: Array.isArray(data) ? data : [] }));
        } catch {
            setJobInterventionsByJob(prev => ({ ...prev, [jobId]: [] }));
            setJobInterventionsErrorByJob(prev => ({ ...prev, [jobId]: 'Errore caricamento interventi.' }));
        } finally {
            setJobInterventionsLoadingByJob(prev => ({ ...prev, [jobId]: false }));
        }
    };

    const loadJobs = async (siteId: string) => {
        setJobsLoadingBySite(prev => ({ ...prev, [siteId]: true }));
        setJobsErrorBySite(prev => ({ ...prev, [siteId]: '' }));
        try {
            const res = await apiFetch(`/api/sites/${siteId}/jobs`);
            if (!res.ok) throw new Error();
            const data = await res.json().catch(() => []);
            const nextJobs = Array.isArray(data) ? data : [];
            setJobsBySite(prev => ({ ...prev, [siteId]: nextJobs }));
            await Promise.all(nextJobs.map((job: Job) => loadJobInterventions(job.id)));
        } catch {
            setJobsBySite(prev => ({ ...prev, [siteId]: [] }));
            setJobsErrorBySite(prev => ({ ...prev, [siteId]: 'Errore caricamento commesse.' }));
        } finally {
            setJobsLoadingBySite(prev => ({ ...prev, [siteId]: false }));
        }
    };

    const loadSites = async () => {
        if (!customer?.id || customer.customerType !== 'AZIENDA') return;
        setSitesLoading(true);
        setSitesError('');
        try {
            const res = await apiFetch(`/api/customers/${customer.id}/sites`);
            if (!res.ok) throw new Error();
            const data = await res.json().catch(() => []);
            const nextSites = Array.isArray(data) ? data : [];
            setSites(nextSites);
            setJobsBySite({});
            setJobsLoadingBySite({});
            setJobsErrorBySite({});
            setJobInterventionsByJob({});
            setJobInterventionsLoadingByJob({});
            setJobInterventionsErrorByJob({});
            await Promise.all(nextSites.map(site => loadJobs(site.id)));
        } catch {
            setSites([]);
            setSitesError('Errore caricamento cantieri.');
        } finally {
            setSitesLoading(false);
        }
    };

    useEffect(() => {
        loadSites();
    }, [customer?.id, customer?.customerType]);

    const handleCreateSiteSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const formEl = e.currentTarget;
        if (!customer?.id) return;
        setSiteSubmitting(true);
        setSitesError('');
        const fd = new FormData(e.currentTarget);
        const label = String(fd.get('label') || '').trim();
        const address = String(fd.get('address') || '').trim();
        const startDate = String(fd.get('startDate') || '').trim();
        const endDate = String(fd.get('endDate') || '').trim();

        if (!address) {
            setSitesError('Indirizzo cantiere obbligatorio.');
            setSiteSubmitting(false);
            return;
        }

        try {
            const res = await apiFetch(`/api/customers/${customer.id}/sites`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    label: label || undefined,
                    address,
                    startDate: startDate || undefined,
                    endDate: endDate || undefined,
                })
            });
            if (!res.ok) {
                const payload = await res.json().catch(() => null);
                throw new Error(payload?.error || 'Errore creazione cantiere.');
            }
            formEl.reset();
            setShowSiteModal(false);
            await loadSites();
        } catch (err) {
            setSitesError(err instanceof Error ? err.message : 'Errore creazione cantiere.');
        } finally {
            setSiteSubmitting(false);
        }
    };

    const handleJobSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!jobModalState?.siteId) return;
        setJobSubmitting(true);
        setJobError('');

        const fd = new FormData(e.currentTarget);
        const code = String(fd.get('code') || '').trim();
        const title = String(fd.get('title') || '').trim();
        const description = String(fd.get('description') || '').trim();
        const status = String(fd.get('status') || 'OPEN') as JobStatus;
        const startDate = String(fd.get('startDate') || '').trim();
        const endDate = String(fd.get('endDate') || '').trim();

        if (!title) {
            setJobError('Titolo commessa obbligatorio.');
            setJobSubmitting(false);
            return;
        }

        const payload = {
            code: code || undefined,
            title,
            description: description || undefined,
            status,
            startDate: startDate || undefined,
            endDate: endDate || undefined,
        };

        const isEdit = Boolean(jobModalState.job?.id);
        const url = isEdit
            ? `/api/jobs/${jobModalState.job!.id}`
            : `/api/sites/${jobModalState.siteId}/jobs`;
        const method = isEdit ? 'PATCH' : 'POST';

        try {
            const res = await apiFetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!res.ok) {
                const errPayload = await res.json().catch(() => null);
                throw new Error(errPayload?.error || 'Errore salvataggio commessa.');
            }
            await loadJobs(jobModalState.siteId);
            setJobModalState(null);
        } catch (err) {
            setJobError(err instanceof Error ? err.message : 'Errore salvataggio commessa.');
        } finally {
            setJobSubmitting(false);
        }
    };

    const getJobInterventionScheduledLabel = (intervention: any) => {
        if (!intervention?.startAt) return 'Non pianificato';
        const d = new Date(intervention.startAt);
        if (Number.isNaN(d.getTime())) return intervention.startAt;
        return d.toLocaleString('it-IT', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const getJobInterventionDurationLabel = (intervention: any) => {
        if (!intervention?.startAt || !intervention?.endAt) return '—';
        const startMs = new Date(intervention.startAt).getTime();
        const endMs = new Date(intervention.endAt).getTime();
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return '—';
        const minutes = Math.floor((endMs - startMs) / 60000);
        return `${minutes} min`;
    };

    const getJobInterventionTechnicianLabel = (intervention: any) => {
        const technicianId = intervention?.technicianId ?? intervention?.secondaryTechnicianId ?? null;
        if (!technicianId) return 'Non assegnato';
        const technician = technicians.find((t) => t.id === technicianId);
        return technician ? technician.name : `Tecnico #${technicianId}`;
    };

    const handleSubmit = async (e: any) => {
        e.preventDefault();
        setSubmitting(true);
        setError('');

        const fd = new FormData(e.target);
        const data = {
            name: fd.get('name') as string,
            companyName: fd.get('companyName') as string || null,
            customerType: (fd.get('customerType') as string) || 'PRIVATO',
            preferredTimeSlot: (fd.get('preferredTimeSlot') as string) || 'INDIFFERENTE',
            email: fd.get('email') as string || null,
            phone: fd.get('phone') as string || null,
            taxCode: fd.get('taxCode') as string || null,
            vatNumber: fd.get('vatNumber') as string || null,
            addressLine: fd.get('addressLine') as string || null,
            physicalAddress: fd.get('physicalAddress') as string || null,
            intercomInfo: fd.get('intercomInfo') as string || null,
            intercomLabel: fd.get('intercomLabel') as string || null,
            city: fd.get('city') as string || null,
            notes: fd.get('notes') as string || null,
        };

        try {
            const url = customer ? `/api/customers/${customer.id}` : '/api/customers';
            const method = customer ? 'PATCH' : 'POST';

            const res = await apiFetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            if (res.status === 409) {
                const err = await res.json();
                setError(`Cliente già presente (${err.data.name}). Email o Telefono duplicati.`);
                return;
            }

            if (!res.ok) throw new Error();
            onSaved();
            onClose();
        } catch (err) {
            setError("Errore durante il salvataggio del cliente.");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex justify-center p-4 pt-10 md:pt-20 z-50 backdrop-blur-sm overflow-y-auto">
            <div className="bg-white rounded-2xl w-full max-w-xl h-fit shadow-xl border border-slate-200 animate-in zoom-in-95 duration-200">
                <div className="flex items-center justify-between p-5 border-b border-slate-100">
                    <h2 className="text-xl font-bold flex items-center gap-2"><User className="w-5 h-5 text-brand-600" /> {customer ? 'Modifica Cliente' : 'Nuovo Cliente'}</h2>
                    <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition"><X className="w-5 h-5" /></button>
                </div>

                <form onSubmit={handleSubmit} className="p-5 space-y-4">
                    {error && <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg border border-red-100">{error}</div>}

                    <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-1">Nome / Azienda (Obbligatorio)</label>
                        <input name="name" defaultValue={customer?.name} required className="w-full border border-slate-300 rounded-lg px-3 py-2 outline-none focus:border-brand-500" placeholder="Mario Rossi" />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1">Tipologia Cliente</label>
                            <select
                                name="customerType"
                                value={customerTypeValue}
                                onChange={(event) => setCustomerTypeValue(event.target.value as 'PRIVATO' | 'AZIENDA')}
                                className="w-full border border-slate-300 rounded-lg px-3 py-2 outline-none focus:border-brand-500 bg-white"
                            >
                                <option value="PRIVATO">Privato</option>
                                <option value="AZIENDA">Azienda</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1">Fascia Oraria Preferita</label>
                            <select name="preferredTimeSlot" defaultValue={customer?.preferredTimeSlot || 'INDIFFERENTE'} className="w-full border border-slate-300 rounded-lg px-3 py-2 outline-none focus:border-brand-500 bg-white">
                                {preferredTimeSlotOptions.map(slot => (
                                    <option key={slot} value={slot}>{slot}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1">Email</label>
                            <input type="email" name="email" defaultValue={customer?.email || ''} className="w-full border border-slate-300 rounded-lg px-3 py-2 outline-none focus:border-brand-500" placeholder="email@example.com" />
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1">Telefono</label>
                            <div className="flex items-center gap-2">
                                <input
                                    ref={phoneInputRef}
                                    type="tel"
                                    name="phone"
                                    defaultValue={customer?.phone || ''}
                                    className="w-full border border-slate-300 rounded-lg px-3 py-2 outline-none focus:border-brand-500"
                                    placeholder="333 1234567"
                                />
                                <button
                                    type="button"
                                    onClick={() => {
                                        void copyPhoneWithToast(phoneInputRef.current?.value || customer?.phone || '');
                                    }}
                                    aria-label="Copia numero"
                                    className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-slate-500 hover:text-slate-700 hover:border-slate-400 transition"
                                >
                                    <Copy className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    </div>
                    {(customer?.email || customer?.phone) && (
                        <div className="flex flex-col gap-1 text-xs text-slate-600 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
                            {customer?.email && <a href={`mailto:${customer.email}`} className="hover:text-brand-600 hover:underline">Email: {customer.email}</a>}
                            {customer?.phone && (
                                <div className="flex items-center gap-2">
                                    <a href={`tel:${sanitizePhoneForTel(customer.phone)}`} className="hover:text-emerald-600 hover:underline">Telefono: {customer.phone}</a>
                                    <button
                                        type="button"
                                        onClick={() => { void copyPhoneWithToast(customer.phone); }}
                                        aria-label="Copia numero"
                                        className="inline-flex items-center justify-center rounded border border-slate-300 bg-white px-1.5 py-1 text-slate-500 hover:text-slate-700 transition"
                                    >
                                        <Copy className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1">Codice fiscale (Opzionale)</label>
                            <input name="taxCode" defaultValue={customer?.taxCode || ''} className="w-full border border-slate-300 rounded-lg px-3 py-2 outline-none focus:border-brand-500" placeholder="RSSMRA80A01H501U" />
                        </div>
                        {customerTypeValue === 'AZIENDA' && (
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-1">Partita IVA (Opzionale)</label>
                                <input name="vatNumber" defaultValue={customer?.vatNumber || ''} className="w-full border border-slate-300 rounded-lg px-3 py-2 outline-none focus:border-brand-500" placeholder="IT12345678901" />
                            </div>
                        )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1">Città</label>
                            <input name="city" defaultValue={customer?.city || ''} className="w-full border border-slate-300 rounded-lg px-3 py-2 outline-none focus:border-brand-500" placeholder="Milano" />
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1">Indirizzo</label>
                            <input name="addressLine" defaultValue={customer?.addressLine || ''} className="w-full border border-slate-300 rounded-lg px-3 py-2 outline-none focus:border-brand-500" placeholder="Via Roma 1" />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1">Indirizzo Fisico</label>
                            <input name="physicalAddress" defaultValue={customer?.physicalAddress || ''} className="w-full border border-slate-300 rounded-lg px-3 py-2 outline-none focus:border-brand-500" placeholder="Via/Ingresso effettivo per intervento" />
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1">Citofono / Scala / Palazzo</label>
                            <input name="intercomInfo" defaultValue={customer?.intercomInfo || ''} className="w-full border border-slate-300 rounded-lg px-3 py-2 outline-none focus:border-brand-500" placeholder="Scala B, interno 12, palazzo rosso" />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-1">Nome su Citofono</label>
                        <input name="intercomLabel" defaultValue={customer?.intercomLabel || ''} maxLength={200} className="w-full border border-slate-300 rounded-lg px-3 py-2 outline-none focus:border-brand-500" placeholder="Rossi / Studio Delta" />
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-1">Nome Azienda Completo (Opzionale)</label>
                        <input name="companyName" defaultValue={customer?.companyName || ''} className="w-full border border-slate-300 rounded-lg px-3 py-2 outline-none focus:border-brand-500" placeholder="Ragione Sociale SPA" />
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-1">Note Cliente (Opzionale)</label>
                        <textarea name="notes" defaultValue={customer?.notes || ''} rows={2} maxLength={500} className="w-full border border-slate-300 rounded-lg px-3 py-2 outline-none focus:border-brand-500" placeholder="Citofono, reception, parcheggio, accessi..." />
                    </div>

                    {customer?.customerType === 'AZIENDA' && (
                        <div className="border border-slate-200 rounded-lg p-3 bg-slate-50">
                            <div className="flex items-center justify-between gap-3 mb-2">
                                <h4 className="text-sm font-semibold text-slate-700">Cantieri</h4>
                                <button
                                    type="button"
                                    onClick={() => setShowSiteModal(true)}
                                    className="text-xs font-semibold text-brand-600 hover:text-brand-700"
                                >
                                    Aggiungi cantiere
                                </button>
                            </div>

                            {sitesLoading && <div className="text-xs text-slate-500">Caricamento cantieri...</div>}
                            {sitesError && <div className="text-xs text-red-600 mb-2">{sitesError}</div>}
                            {!sitesLoading && sites.length === 0 && (
                                <div className="text-xs text-slate-500">Nessun cantiere registrato.</div>
                            )}
                            <div className="space-y-2">
                                {sites.map(site => {
                                    const range = formatSiteDateRange(site);
                                    const siteJobs = jobsBySite[site.id] || [];
                                    const jobsLoading = jobsLoadingBySite[site.id];
                                    const jobsError = jobsErrorBySite[site.id];
                                    return (
                                        <div key={site.id} className="bg-white border border-slate-200 rounded-lg px-3 py-2">
                                            <div className="flex items-center justify-between gap-2">
                                                <div className="text-sm font-medium text-slate-700">
                                                    {site.label || 'Cantiere'}
                                                </div>
                                                {customer && (
                                                    <button
                                                        type="button"
                                                        onClick={() => onCreateInterventionAtSite(customer, site.address)}
                                                        className="text-xs font-semibold text-brand-600 hover:text-brand-700"
                                                    >
                                                        Nuovo intervento qui
                                                    </button>
                                                )}
                                            </div>
                                            <div className="text-xs text-slate-600">{site.address}</div>
                                            {range && <div className="text-[11px] text-slate-500 mt-1">{range}</div>}

                                            <div className="mt-3 pt-2 border-t border-slate-100">
                                                <div className="flex items-center justify-between gap-2 mb-2">
                                                    <h5 className="text-xs font-semibold text-slate-700">Commesse</h5>
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setJobError('');
                                                            setJobModalState({ siteId: site.id });
                                                        }}
                                                        className="text-xs font-semibold text-brand-600 hover:text-brand-700"
                                                    >
                                                        + Nuova Commessa
                                                    </button>
                                                </div>

                                                {jobsLoading && <div className="text-[11px] text-slate-500">Caricamento commesse...</div>}
                                                {jobsError && <div className="text-[11px] text-red-600">{jobsError}</div>}
                                                {!jobsLoading && !jobsError && siteJobs.length === 0 && (
                                                    <div className="text-[11px] text-slate-500">Nessuna commessa associata.</div>
                                                )}

                                                {!jobsLoading && !jobsError && siteJobs.length > 0 && (
                                                    <div className="space-y-1.5">
                                                        {siteJobs.map(job => (
                                                            <div key={job.id} className="bg-slate-50 border border-slate-100 rounded-md px-2 py-1.5">
                                                                <div className="flex items-start justify-between gap-2">
                                                                    <div className="min-w-0">
                                                                        <div className="flex items-center gap-1.5 flex-wrap">
                                                                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-semibold ${getJobStatusBadgeClasses(job.status)}`}>
                                                                                {job.status}
                                                                            </span>
                                                                            <span className="text-xs font-medium text-slate-700 truncate">
                                                                                {job.code ? `${job.code} · ` : ''}{job.title}
                                                                            </span>
                                                                        </div>
                                                                    </div>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => {
                                                                            setJobError('');
                                                                            setJobModalState({ siteId: site.id, job });
                                                                        }}
                                                                        className="text-[11px] font-semibold text-slate-600 hover:text-brand-700"
                                                                    >
                                                                        Modifica
                                                                    </button>
                                                                </div>

                                                                <div className="mt-2 pt-2 border-t border-slate-200/70">
                                                                    <div className="flex items-center justify-between gap-2 mb-1">
                                                                        <span className="text-[11px] font-semibold text-slate-700">Interventi</span>
                                                                        {customer && (
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => onCreateInterventionAtJob(job, site, customer)}
                                                                                className="text-[11px] font-semibold text-brand-600 hover:text-brand-700"
                                                                            >
                                                                                + Nuovo Intervento
                                                                            </button>
                                                                        )}
                                                                    </div>

                                                                    {jobInterventionsLoadingByJob[job.id] && (
                                                                        <div className="text-[11px] text-slate-500">Caricamento interventi...</div>
                                                                    )}
                                                                    {jobInterventionsErrorByJob[job.id] && (
                                                                        <div className="text-[11px] text-red-600">{jobInterventionsErrorByJob[job.id]}</div>
                                                                    )}
                                                                    {!jobInterventionsLoadingByJob[job.id] &&
                                                                        !jobInterventionsErrorByJob[job.id] &&
                                                                        (jobInterventionsByJob[job.id] || []).length === 0 && (
                                                                            <div className="text-[11px] text-slate-500">Nessun intervento collegato.</div>
                                                                    )}
                                                                    {!jobInterventionsLoadingByJob[job.id] &&
                                                                        !jobInterventionsErrorByJob[job.id] &&
                                                                        (jobInterventionsByJob[job.id] || []).length > 0 && (
                                                                            <div className="space-y-1">
                                                                                {(jobInterventionsByJob[job.id] || []).map((intervention: any) => (
                                                                                    <div key={intervention.id} className="text-[11px] text-slate-600 bg-white border border-slate-200 rounded px-2 py-1">
                                                                                        <div><span className="font-medium text-slate-700">Data:</span> {getJobInterventionScheduledLabel(intervention)}</div>
                                                                                        <div><span className="font-medium text-slate-700">Tecnico:</span> {getJobInterventionTechnicianLabel(intervention)}</div>
                                                                                        <div><span className="font-medium text-slate-700">Durata:</span> {getJobInterventionDurationLabel(intervention)}</div>
                                                                                    </div>
                                                                                ))}
                                                                            </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    <div className="pt-4 flex justify-end gap-3 border-t border-slate-100">
                        <button type="button" onClick={onClose} className="px-4 py-2 text-slate-600 hover:bg-slate-100 font-medium rounded-lg">Annulla</button>
                        <button type="submit" disabled={submitting} className="px-5 py-2 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-lg shadow-sm disabled:opacity-50">
                            {submitting ? 'Salvataggio...' : (customer ? 'Salva Modifiche' : 'Crea Cliente')}
                        </button>
                    </div>
                </form>
            </div>

            {showSiteModal && customer?.id && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
                    <div className="bg-white rounded-xl w-full max-w-md shadow-xl border border-slate-200">
                        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                            <h3 className="font-semibold text-slate-800">Nuovo Cantiere</h3>
                            <button
                                type="button"
                                onClick={() => setShowSiteModal(false)}
                                className="text-slate-400 hover:text-slate-700"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                        <form onSubmit={handleCreateSiteSubmit} className="p-4 space-y-3">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Label (Opzionale)</label>
                                <input name="label" className="w-full border border-slate-300 rounded-lg px-3 py-2 outline-none focus:border-brand-500" placeholder="Es. Cantiere Nord" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Indirizzo (Obbligatorio)</label>
                                <input name="address" required className="w-full border border-slate-300 rounded-lg px-3 py-2 outline-none focus:border-brand-500" placeholder="Via Roma 10, Milano" />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Data Inizio</label>
                                    <input type="date" name="startDate" className="w-full border border-slate-300 rounded-lg px-3 py-2 outline-none focus:border-brand-500" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Data Fine</label>
                                    <input type="date" name="endDate" className="w-full border border-slate-300 rounded-lg px-3 py-2 outline-none focus:border-brand-500" />
                                </div>
                            </div>
                            <div className="pt-2 flex justify-end gap-2">
                                <button type="button" onClick={() => setShowSiteModal(false)} className="px-3 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">Annulla</button>
                                <button type="submit" disabled={siteSubmitting} className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white font-semibold hover:bg-brand-700 disabled:opacity-50">
                                    {siteSubmitting ? 'Salvataggio...' : 'Salva Cantiere'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {jobModalState && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
                    <div className="bg-white rounded-xl w-full max-w-md shadow-xl border border-slate-200">
                        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                            <h3 className="font-semibold text-slate-800">
                                {jobModalState.job ? 'Modifica Commessa' : 'Nuova Commessa'}
                            </h3>
                            <button
                                type="button"
                                onClick={() => setJobModalState(null)}
                                className="text-slate-400 hover:text-slate-700"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                        <form onSubmit={handleJobSubmit} className="p-4 space-y-3">
                            {jobError && (
                                <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-md px-2 py-1.5">
                                    {jobError}
                                </div>
                            )}
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Codice (Opzionale)</label>
                                <input
                                    name="code"
                                    defaultValue={jobModalState.job?.code || ''}
                                    className="w-full border border-slate-300 rounded-lg px-3 py-2 outline-none focus:border-brand-500"
                                    placeholder="JOB-001"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Titolo (Obbligatorio)</label>
                                <input
                                    name="title"
                                    required
                                    defaultValue={jobModalState.job?.title || ''}
                                    className="w-full border border-slate-300 rounded-lg px-3 py-2 outline-none focus:border-brand-500"
                                    placeholder="Completamento impianto"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Descrizione</label>
                                <textarea
                                    name="description"
                                    rows={2}
                                    defaultValue={jobModalState.job?.description || ''}
                                    className="w-full border border-slate-300 rounded-lg px-3 py-2 outline-none focus:border-brand-500"
                                    placeholder="Dettagli operativi"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Stato</label>
                                <select
                                    name="status"
                                    defaultValue={jobModalState.job?.status || 'OPEN'}
                                    className="w-full border border-slate-300 rounded-lg px-3 py-2 outline-none focus:border-brand-500 bg-white"
                                >
                                    {jobStatusOptions.map(status => (
                                        <option key={status} value={status}>{status}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Data Inizio</label>
                                    <input
                                        type="date"
                                        name="startDate"
                                        defaultValue={jobModalState.job?.startDate ? jobModalState.job.startDate.slice(0, 10) : ''}
                                        className="w-full border border-slate-300 rounded-lg px-3 py-2 outline-none focus:border-brand-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Data Fine</label>
                                    <input
                                        type="date"
                                        name="endDate"
                                        defaultValue={jobModalState.job?.endDate ? jobModalState.job.endDate.slice(0, 10) : ''}
                                        className="w-full border border-slate-300 rounded-lg px-3 py-2 outline-none focus:border-brand-500"
                                    />
                                </div>
                            </div>
                            <div className="pt-2 flex justify-end gap-2">
                                <button
                                    type="button"
                                    onClick={() => setJobModalState(null)}
                                    className="px-3 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                                >
                                    Annulla
                                </button>
                                <button
                                    type="submit"
                                    disabled={jobSubmitting}
                                    className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white font-semibold hover:bg-brand-700 disabled:opacity-50"
                                >
                                    {jobSubmitting ? 'Salvataggio...' : 'Salva Commessa'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}

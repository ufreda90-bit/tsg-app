import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Team, Technician, Customer, Intervention, AttachmentRecord, CreateInterventionInitialData } from '../types';
import { X, UploadCloud, Paperclip, Trash2, Search, Building2, User, Copy, Mic, Square } from 'lucide-react';
import { useState, useEffect, useRef, useMemo } from 'react';
import { apiFetch } from '../lib/apiFetch';
import { buildDemoTeamsFromTechnicians, buildTeamMapsFromTeams, fetchTeams } from '../lib/teamData';
import { addMinutesToClockTime, suggestStartTimeFromPreferredSlot } from '../lib/preferredTimeSlot';
import { toast } from './Toast';
import { copyTextToClipboard, sanitizePhoneForCopy } from '../lib/clipboard';
const ATTACHMENT_MAX_SIZE_MB = Number(import.meta.env.VITE_ATTACHMENT_MAX_FILE_SIZE_MB || 15);
const SCHEDULE_STEP_MINUTES = 15;
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, idx) => String(idx).padStart(2, '0'));
const QUARTER_MINUTE_OPTIONS = ['00', '15', '30', '45'] as const;

function getUploadErrorMessage(status: number, payload: any, fallback: string) {
  if (status === 413) return 'File troppo grande o troppi file.';
  if (status === 415) return 'Tipo file non supportato. Carica immagini, video, PDF o audio consentiti.';
  if (status === 429) {
    return 'Troppi upload. Attendi qualche secondo e riprova.';
  }
  return payload?.error || payload?.message || fallback;
}

function roundDateToNearestStep(date: Date, stepMinutes = SCHEDULE_STEP_MINUTES) {
  const stepMs = stepMinutes * 60 * 1000;
  return new Date(Math.round(date.getTime() / stepMs) * stepMs);
}

function normalizeClockValueToStep(value?: string, stepMinutes = SCHEDULE_STEP_MINUTES): string {
  const raw = (value || '').trim();
  if (!raw) return '';
  const match = raw.match(/^(\d{2}):(\d{2})$/);
  if (!match) return raw;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return raw;
  }
  const totalMinutes = hours * 60 + minutes;
  const roundedTotalMinutes = Math.round(totalMinutes / stepMinutes) * stepMinutes;
  const clamped = Math.min(23 * 60 + 45, Math.max(0, roundedTotalMinutes));
  const outH = Math.floor(clamped / 60);
  const outM = clamped % 60;
  return `${String(outH).padStart(2, '0')}:${String(outM).padStart(2, '0')}`;
}

function splitClockValue(value?: string): { hour: string; minute: string } {
  const normalized = normalizeClockValueToStep(value);
  if (!normalized) {
    return { hour: '', minute: '' };
  }
  const [hour, minute] = normalized.split(':');
  return { hour: hour || '', minute: minute || '' };
}

function formatRecordingDuration(totalSeconds: number) {
  const safe = Math.max(0, totalSeconds);
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

const schema = z.object({
  title: z.string().min(1, "Titolo obbligatorio"),
  address: z.string().min(1, "Indirizzo obbligatorio"),
  description: z.string().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]),
  technicianId: z.string().optional(),
  secondaryTechnicianId: z.string().optional(),
  scheduledDate: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  customerNameSnapshot: z.string().optional(),
  customerEmailSnapshot: z.string().optional(),
  customerPhoneSnapshot: z.string().optional(),
  customerAddressSnapshot: z.string().optional(),
  customerTaxCodeSnapshot: z.string().optional(),
  customerVatNumberSnapshot: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

type Prefill = {
  scheduledDate?: string;
  startTime?: string;
  endTime?: string;
  technicianId?: number | null;
  secondaryTechnicianId?: number | null;
};

type CreateProps = {
  mode?: 'create';
  initialData?: CreateInterventionInitialData;
  prefill?: Prefill;
  onClose: () => void;
  onSuccess: () => void;
  technicians: Technician[];
};

type EditProps = {
  mode: 'edit';
  initialData: Intervention;
  prefill?: Prefill;
  onClose: () => void;
  onSuccess: () => void;
  technicians: Technician[];
};

type Props = CreateProps | EditProps;

export default function CreateInterventionModal(props: Props) {
  const { mode = 'create', prefill, onClose, onSuccess, technicians } = props;
  const editInitialData = props.mode === 'edit' ? props.initialData : null;
  const createInitialData = props.mode === 'edit' ? undefined : props.initialData;
  const [backendTeams, setBackendTeams] = useState<Team[] | null>(null);
  const teamsFetchSeqRef = useRef(0);
  const effectiveTeams = useMemo(() => {
    if (!backendTeams) return [];
    if (backendTeams.length > 0) return backendTeams;
    if (import.meta.env.DEV) {
      return buildDemoTeamsFromTechnicians(technicians);
    }
    return [];
  }, [backendTeams, technicians]);
  const teamMaps = useMemo(() => buildTeamMapsFromTeams(effectiveTeams), [effectiveTeams]);

  // Custom CRM logic
  const [customerSearch, setCustomerSearch] = useState('');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const [adminAttachments, setAdminAttachments] = useState<AttachmentRecord[]>([]);
  const [pendingAdminFiles, setPendingAdminFiles] = useState<File[]>([]);
  const [loadingAdminAttachments, setLoadingAdminAttachments] = useState(false);
  const [uploadingAdminAttachments, setUploadingAdminAttachments] = useState(false);
  const [isRecordingAudio, setIsRecordingAudio] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [audioRecorderError, setAudioRecorderError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<BlobPart[]>([]);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingTimerRef = useRef<number | null>(null);

  // Popup confirmation logic
  const [showCRMConfirm, setShowCRMConfirm] = useState(false);
  const [pendingFormData, setPendingFormData] = useState<FormData | null>(null);
  const createInitialDataAppliedRef = useRef(false);

  const { register, handleSubmit, setValue, reset, watch, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      priority: 'MEDIUM'
    }
  });

  useEffect(() => {
    const controller = new AbortController();
    const seq = ++teamsFetchSeqRef.current;
    void (async () => {
      const result = await fetchTeams(controller.signal);
      if (controller.signal.aborted || seq !== teamsFetchSeqRef.current) return;
      if (result.ok) {
        setBackendTeams(result.teams);
      } else {
        setBackendTeams([]);
      }
    })();
    return () => {
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (mode === 'edit' && editInitialData) {
      const pad = (v: number) => String(v).padStart(2, '0');
      const formatDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      const formatTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

      reset({
        title: editInitialData.title,
        address: editInitialData.address,
        description: editInitialData.description || undefined,
        priority: editInitialData.priority,
        technicianId: editInitialData.technicianId ? String(teamMaps.techIdToTeamId.get(editInitialData.technicianId) ?? editInitialData.technicianId) : undefined,
        secondaryTechnicianId: editInitialData.secondaryTechnicianId ? String(teamMaps.techIdToTeamId.get(editInitialData.secondaryTechnicianId) ?? editInitialData.secondaryTechnicianId) : undefined,
        scheduledDate: editInitialData.startAt ? formatDate(new Date(editInitialData.startAt)) : undefined,
        startTime: editInitialData.startAt ? formatTime(new Date(editInitialData.startAt)) : undefined,
        endTime: editInitialData.endAt ? formatTime(new Date(editInitialData.endAt)) : undefined,
        customerNameSnapshot: editInitialData.customerNameSnapshot || undefined,
        customerEmailSnapshot: editInitialData.customerEmailSnapshot || undefined,
        customerPhoneSnapshot: editInitialData.customerPhoneSnapshot || undefined,
        customerAddressSnapshot: editInitialData.customerAddressSnapshot || undefined,
        customerTaxCodeSnapshot: editInitialData.customer?.taxCode || undefined,
        customerVatNumberSnapshot: editInitialData.customer?.vatNumber || undefined,
      });
      if (editInitialData.customerId) {
        setSelectedCustomerId(editInitialData.customerId);
        setSelectedCustomer(editInitialData.customer || null);
        setCustomerSearch(editInitialData.customer?.name || editInitialData.customerNameSnapshot || '');
      }
    }
  }, [mode, editInitialData, reset, teamMaps.techIdToTeamId]);

  useEffect(() => {
    if (mode !== 'edit' || !editInitialData) return;
    if (effectiveTeams.length === 0) {
      setValue('technicianId', '');
      setValue('secondaryTechnicianId', '');
      return;
    }
    const primaryTeamId = editInitialData.technicianId
      ? (teamMaps.techIdToTeamId.get(editInitialData.technicianId) ?? null)
      : null;
    const secondaryTeamId = editInitialData.secondaryTechnicianId
      ? (teamMaps.techIdToTeamId.get(editInitialData.secondaryTechnicianId) ?? null)
      : null;
    setValue('technicianId', primaryTeamId ? String(primaryTeamId) : '');
    setValue('secondaryTechnicianId', secondaryTeamId ? String(secondaryTeamId) : '');
  }, [mode, editInitialData, effectiveTeams.length, teamMaps.techIdToTeamId, setValue]);

  useEffect(() => {
    if (mode === 'edit' && editInitialData?.id) {
      loadAdminAttachments(editInitialData.id);
    } else {
      setAdminAttachments([]);
    }
  }, [mode, editInitialData?.id]);

  useEffect(() => {
    if (mode !== 'create' || !prefill) return;
    if (prefill.scheduledDate) setValue('scheduledDate', prefill.scheduledDate);
    if (prefill.startTime) setValue('startTime', prefill.startTime);
    if (prefill.endTime) setValue('endTime', prefill.endTime);
    if (prefill.technicianId) setValue('technicianId', String(prefill.technicianId));
    if (prefill.secondaryTechnicianId) setValue('secondaryTechnicianId', String(prefill.secondaryTechnicianId));
  }, [mode, prefill, setValue]);

  useEffect(() => {
    if (mode !== 'create' || !createInitialData || createInitialDataAppliedRef.current) return;
    createInitialDataAppliedRef.current = true;
    if (createInitialData.customerId) {
      setSelectedCustomerId(createInitialData.customerId);
    }
    if (createInitialData.customer) {
      setSelectedCustomer(createInitialData.customer);
      setCustomerSearch(createInitialData.customer.name + (createInitialData.customer.companyName ? ` (${createInitialData.customer.companyName})` : ''));
    } else if (createInitialData.customerNameSnapshot) {
      setCustomerSearch(createInitialData.customerNameSnapshot);
    }
    if (createInitialData.address) setValue('address', createInitialData.address);
    if (createInitialData.customerNameSnapshot) setValue('customerNameSnapshot', createInitialData.customerNameSnapshot);
    if (createInitialData.customerEmailSnapshot) setValue('customerEmailSnapshot', createInitialData.customerEmailSnapshot);
    if (createInitialData.customerPhoneSnapshot) setValue('customerPhoneSnapshot', createInitialData.customerPhoneSnapshot);
    if (createInitialData.customerAddressSnapshot) setValue('customerAddressSnapshot', createInitialData.customerAddressSnapshot);
    if (createInitialData.customer?.taxCode) setValue('customerTaxCodeSnapshot', createInitialData.customer.taxCode);
    if (createInitialData.customer?.vatNumber) setValue('customerVatNumberSnapshot', createInitialData.customer.vatNumber);
  }, [mode, createInitialData, setValue]);

  const searchRef = useRef<HTMLDivElement>(null);
  const scheduleTouchedByUserRef = useRef(false);
  const customerPhoneSnapshotValue = watch('customerPhoneSnapshot') || '';
  const startTimeValue = watch('startTime') || '';
  const endTimeValue = watch('endTime') || '';
  const startTimeParts = splitClockValue(startTimeValue);
  const endTimeParts = splitClockValue(endTimeValue);

  const startTimeField = register('startTime');
  const endTimeField = register('endTime');

  const setQuarterTimeValue = (field: 'startTime' | 'endTime', nextHour: string, nextMinute: string) => {
    scheduleTouchedByUserRef.current = true;
    if (!nextHour || !nextMinute) {
      setValue(field, '', { shouldDirty: true, shouldValidate: true });
      return;
    }
    const normalized = normalizeClockValueToStep(`${nextHour}:${nextMinute}`);
    setValue(field, normalized, { shouldDirty: true, shouldValidate: true });
  };

  useEffect(() => {
    // Close dropdown on click outside
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowSearchDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleCopyPhone = async (rawPhone: string) => {
    const sanitized = sanitizePhoneForCopy(rawPhone);
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
  };

  useEffect(() => {
    const timer = setTimeout(async () => {
      if (customerSearch.trim().length > 1) {
        setIsSearching(true);
        try {
          const res = await apiFetch(`/api/customers?search=${encodeURIComponent(customerSearch)}`);
          const data = await res.json();
          setCustomers(Array.isArray(data) ? data : []);
          setShowSearchDropdown(true);
        } catch {
          setCustomers([]);
        } finally {
          setIsSearching(false);
        }
      } else {
        setCustomers([]);
        setShowSearchDropdown(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [customerSearch]);

  useEffect(() => {
    if (!selectedCustomerId) return;
    if (selectedCustomer?.id === selectedCustomerId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`/api/customers/${selectedCustomerId}`);
        if (!res.ok) return;
        const data = await res.json().catch(() => null);
        if (!cancelled && data?.id === selectedCustomerId) {
          setSelectedCustomer(data as Customer);
        }
      } catch {
        // keep silent in modal
      }
    })();
    return () => { cancelled = true; };
  }, [selectedCustomerId, selectedCustomer?.id]);

  const selectCustomer = (c: Customer) => {
    setSelectedCustomerId(c.id);
    setSelectedCustomer(c);
    setCustomerSearch(c.name + (c.companyName ? ` (${c.companyName})` : ''));
    setShowSearchDropdown(false);

    // Auto-fill snapshots
    setValue('customerNameSnapshot', c.name);
    setValue('customerEmailSnapshot', c.email || '');
    setValue('customerPhoneSnapshot', c.phone1 || c.phone2 || c.phone || '');
    setValue('customerAddressSnapshot', c.addressLine || '');
    setValue('customerTaxCodeSnapshot', c.taxCode || '');
    setValue('customerVatNumberSnapshot', c.vatNumber || '');
    if (c.addressLine) {
      setValue('address', c.addressLine); // optionally populate intervention address
    }

    const currentDate = (watch('scheduledDate') || '').trim();
    const currentStart = (watch('startTime') || '').trim();
    const currentEnd = (watch('endTime') || '').trim();
    if (!scheduleTouchedByUserRef.current && currentDate && !currentStart && !currentEnd) {
      const suggestedStart = suggestStartTimeFromPreferredSlot({
        preferredTimeSlot: c.preferredTimeSlot,
        scheduledDate: currentDate
      });
      if (suggestedStart) {
        const suggestedEnd = addMinutesToClockTime(suggestedStart, 120);
        setValue('startTime', suggestedStart);
        if (suggestedEnd) {
          setValue('endTime', suggestedEnd);
        }
      }
    }
  };

  const handleManualTyping = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCustomerSearch(e.target.value);
    setSelectedCustomerId(null); // break the link if they type manually
    setSelectedCustomer(null);
  };

  const clearCustomerLink = () => {
    setSelectedCustomerId(null);
    setSelectedCustomer(null);
    setCustomerSearch('');
    setValue('customerNameSnapshot', '');
    setValue('customerEmailSnapshot', '');
    setValue('customerPhoneSnapshot', '');
    setValue('customerAddressSnapshot', '');
    setValue('customerTaxCodeSnapshot', '');
    setValue('customerVatNumberSnapshot', '');
  };

  const handleUseCompanyAddress = () => {
    const companyAddress = selectedCustomer?.addressLine || selectedCustomer?.physicalAddress || '';
    if (companyAddress) {
      setValue('address', companyAddress);
    }
  };

  const mergeAttachments = (current: AttachmentRecord[], incoming: AttachmentRecord[]) => {
    const map = new Map<string, AttachmentRecord>();
    for (const item of [...incoming, ...current]) {
      map.set(item.id, item);
    }
    return Array.from(map.values());
  };

  const loadAdminAttachments = async (interventionId: number) => {
    setLoadingAdminAttachments(true);
    try {
      const res = await apiFetch(`/api/interventions/${interventionId}/details`);
      if (!res.ok) return;
      const data = await res.json().catch(() => null);
      setAdminAttachments(Array.isArray(data?.attachments) ? data.attachments : []);
    } catch {
      // keep silent in modal
    } finally {
      setLoadingAdminAttachments(false);
    }
  };

  const uploadAdminAttachments = async (interventionId: number, filesToUpload: File[]) => {
    if (!filesToUpload.length) return;
    setUploadingAdminAttachments(true);
    try {
      const formData = new FormData();
      for (const file of filesToUpload) {
        formData.append('files', file);
      }
      const res = await apiFetch(`/api/interventions/${interventionId}/attachments`, {
        method: 'POST',
        body: formData
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        alert(getUploadErrorMessage(res.status, payload, 'Errore upload allegati admin'));
        return;
      }
      const created = Array.isArray(payload?.attachments) ? (payload.attachments as AttachmentRecord[]) : [];
      if (created.length > 0) {
        setAdminAttachments(prev => mergeAttachments(prev, created));
      } else {
        await loadAdminAttachments(interventionId);
      }
    } catch {
      alert('Errore upload allegati admin');
    } finally {
      setUploadingAdminAttachments(false);
    }
  };

  const enqueueOrUploadAttachments = async (selected: File[]) => {
    if (!selected.length) return;
    if (mode === 'edit' && editInitialData?.id) {
      await uploadAdminAttachments(editInitialData.id, selected);
      return;
    }
    setPendingAdminFiles(prev => [...prev, ...selected]);
  };

  const handleAdminAttachmentChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    e.target.value = '';
    await enqueueOrUploadAttachments(selected);
  };

  const stopRecordingTimer = () => {
    if (recordingTimerRef.current !== null) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  };

  const stopRecordingTracks = () => {
    if (!recordingStreamRef.current) return;
    for (const track of recordingStreamRef.current.getTracks()) {
      track.stop();
    }
    recordingStreamRef.current = null;
  };

  const stopActiveRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;
    if (recorder.state === 'recording') {
      recorder.stop();
      return;
    }
    stopRecordingTimer();
    stopRecordingTracks();
    setIsRecordingAudio(false);
    setRecordingSeconds(0);
  };

  const startAudioRecording = async () => {
    if (isRecordingAudio || uploadingAdminAttachments) return;
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setAudioRecorderError('Registrazione audio non supportata su questo browser.');
      return;
    }

    setAudioRecorderError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordingStreamRef.current = stream;
      recordingChunksRef.current = [];

      const mimeCandidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
      const supportedMimeType = mimeCandidates.find(
        (candidate) => typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(candidate)
      );
      const recorder = supportedMimeType ? new MediaRecorder(stream, { mimeType: supportedMimeType }) : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data && event.data.size > 0) {
          recordingChunksRef.current.push(event.data);
        }
      };

      recorder.onerror = () => {
        setAudioRecorderError('Errore durante la registrazione audio.');
        stopRecordingTimer();
        stopRecordingTracks();
        setIsRecordingAudio(false);
        mediaRecorderRef.current = null;
      };

      recorder.onstop = async () => {
        stopRecordingTimer();
        setIsRecordingAudio(false);
        setRecordingSeconds(0);

        const chunks = recordingChunksRef.current;
        recordingChunksRef.current = [];
        stopRecordingTracks();
        mediaRecorderRef.current = null;

        if (chunks.length === 0) return;
        const mimeType = recorder.mimeType || 'audio/webm';
        const extension = mimeType.includes('mp4') ? 'm4a' : mimeType.includes('ogg') ? 'ogg' : 'webm';
        const fileName = `intervento-audio-${Date.now()}.${extension}`;
        const audioBlob = new Blob(chunks, { type: mimeType });
        const audioFile = new File([audioBlob], fileName, { type: mimeType });
        await enqueueOrUploadAttachments([audioFile]);
      };

      recorder.start();
      setIsRecordingAudio(true);
      setRecordingSeconds(0);
      recordingTimerRef.current = window.setInterval(() => {
        setRecordingSeconds(prev => prev + 1);
      }, 1000);
    } catch {
      setAudioRecorderError('Impossibile avviare la registrazione audio. Controlla i permessi microfono.');
      stopRecordingTimer();
      stopRecordingTracks();
      setIsRecordingAudio(false);
      mediaRecorderRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      if (recordingTimerRef.current !== null) {
        window.clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state === 'recording') {
        recorder.ondataavailable = null;
        recorder.onerror = null;
        recorder.onstop = null;
        recorder.stop();
      }
      mediaRecorderRef.current = null;
      if (recordingStreamRef.current) {
        for (const track of recordingStreamRef.current.getTracks()) {
          track.stop();
        }
        recordingStreamRef.current = null;
      }
    };
  }, []);

  const removePendingAdminFile = (index: number) => {
    setPendingAdminFiles(prev => prev.filter((_, i) => i !== index));
  };

  const submitIntervention = async (data: FormData, createCustomerInCRM: boolean = false) => {
    try {
      let finalCustomerId = selectedCustomerId;
      const {
        scheduledDate,
        startTime,
        endTime,
        technicianId: selectedPrimaryTeamIdRaw,
        secondaryTechnicianId: selectedSecondaryTeamIdRaw,
        customerTaxCodeSnapshot,
        customerVatNumberSnapshot,
        ...rest
      } = data;
      const scheduledDateVal = scheduledDate?.trim();
      const startTimeVal = startTime?.trim();
      const endTimeVal = endTime?.trim();
      let startAt: string | undefined;
      let endAt: string | undefined;

      if (scheduledDateVal || startTimeVal || endTimeVal) {
        if (!scheduledDateVal || !startTimeVal || !endTimeVal) {
          alert('Inserisci data, ora inizio e ora fine');
          return;
        }
        const [y, m, d] = scheduledDateVal.split('-').map(Number);
        const [sh, sm] = startTimeVal.split(':').map(Number);
        const [eh, em] = endTimeVal.split(':').map(Number);
        const startDt = new Date(y, m - 1, d, sh, sm || 0, 0, 0);
        const endDt = new Date(y, m - 1, d, eh, em || 0, 0, 0);
        const roundedStart = roundDateToNearestStep(startDt);
        let roundedEnd = roundDateToNearestStep(endDt);
        if (roundedEnd <= roundedStart) {
          roundedEnd = new Date(roundedStart.getTime() + SCHEDULE_STEP_MINUTES * 60 * 1000);
        }
        startAt = roundedStart.toISOString();
        endAt = roundedEnd.toISOString();
      }

      // Se confermiamo l'aggiunta al CRM procediamo a salvarlo
      if (createCustomerInCRM) {
        const resCustomer = await apiFetch('/api/customers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: data.customerNameSnapshot,
            email: data.customerEmailSnapshot || undefined,
            phone1: data.customerPhoneSnapshot || undefined,
            taxCode: customerTaxCodeSnapshot || undefined,
            vatNumber: customerVatNumberSnapshot || undefined,
            addressLine: data.customerAddressSnapshot || data.address || undefined
          })
        });
        if (resCustomer.ok) {
          const newC = await resCustomer.json();
          finalCustomerId = newC.id;
        } else if (resCustomer.status === 409) {
          // Cliente già esistente dedup hit
          const err = await resCustomer.json();
          finalCustomerId = err.data.id;
        } else {
          let message = "Errore durante la creazione dell'anagrafica cliente";
          try {
            const err = await resCustomer.json();
            message = err?.error || err?.message || message;
          } catch {
            // ignore parsing errors
          }
          alert(message);
          return;
        }
      }

      const selectedPrimaryTeamId = selectedPrimaryTeamIdRaw ? Number(selectedPrimaryTeamIdRaw) : null;
      const selectedSecondaryTeamId = selectedSecondaryTeamIdRaw ? Number(selectedSecondaryTeamIdRaw) : null;
      const primaryTeam =
        selectedPrimaryTeamId && Number.isFinite(selectedPrimaryTeamId)
          ? effectiveTeams.find(team => team.id === selectedPrimaryTeamId) ?? null
          : null;
      const secondaryTeam =
        selectedSecondaryTeamId && Number.isFinite(selectedSecondaryTeamId)
          ? effectiveTeams.find(team => team.id === selectedSecondaryTeamId) ?? null
          : null;

      let technicianId: number | null = primaryTeam?.memberIds[0] ?? null;
      let secondaryTechnicianId: number | null = primaryTeam?.memberIds[1] ?? null;

      if (technicianId && secondaryTeam?.memberIds.length && !secondaryTechnicianId) {
        secondaryTechnicianId = secondaryTeam.memberIds[0] ?? null;
      }

      if (technicianId && secondaryTechnicianId === technicianId) {
        const secondaryCandidates = [...(primaryTeam?.memberIds ?? []), ...(secondaryTeam?.memberIds ?? [])]
          .filter((id, index, ids) => Number.isFinite(id) && id !== technicianId && ids.indexOf(id) === index);
        secondaryTechnicianId = secondaryCandidates[0] ?? null;
      }

      const hasTeam = Boolean(primaryTeam && primaryTeam.memberIds.length > 0 && technicianId);
      const status =
        (startAt && endAt && hasTeam) ? 'SCHEDULED' : (editInitialData?.status || 'SCHEDULED');

      const payload = {
        ...rest,
        technicianId,
        secondaryTechnicianId,
        status,
        customerId: finalCustomerId,
        ...(startAt && endAt ? { startAt, endAt } : {}),
        ...(mode === 'edit' && editInitialData ? { version: editInitialData.version } : {})
      };

      const method = mode === 'edit' ? 'PATCH' : 'POST';
      const url = mode === 'edit' && editInitialData ? `/api/interventions/${editInitialData.id}` : '/api/interventions';

      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        let message = 'Errore durante il salvataggio';
        try {
          const err = await res.json();
          message = err.message || err.error || message;
        } catch {
          // ignore json parse errors
        }
        alert(message);
        return;
      }
      const savedIntervention = await res.json().catch(() => null);
      const targetInterventionId =
        (mode === 'edit' ? editInitialData?.id : savedIntervention?.id) ?? savedIntervention?.id;

      if (targetInterventionId && pendingAdminFiles.length > 0) {
        await uploadAdminAttachments(Number(targetInterventionId), pendingAdminFiles);
        setPendingAdminFiles([]);
      }
      onSuccess();
    } catch (e) {
      alert('Errore compilando la modale');
    }
  };

  const onSubmit = async (data: FormData) => {
    // Controllo POPUP CRM: se non ho selezionato uno dal CRM (`!selectedCustomerId`),
    // ma ho compilato nome cliente, propongo di aggiungerlo.
    const hasName = data.customerNameSnapshot?.trim();

    if (!selectedCustomerId && hasName) {
      setPendingFormData(data);
      setShowCRMConfirm(true);
    } else {
      // Procediamo normalmente senza popup
      await submitIntervention(data, false);
    }
  };

  const handleCRMConfirmYes = async () => {
    setShowCRMConfirm(false);
    if (pendingFormData) await submitIntervention(pendingFormData, true);
  };

  const handleCRMConfirmNo = async () => {
    setShowCRMConfirm(false);
    if (pendingFormData) await submitIntervention(pendingFormData, false);
  };

  return (
    <>
      <div className={`fixed inset-0 flex items-center justify-center z-[50] backdrop-blur-md ${showCRMConfirm ? 'bg-black/50' : 'bg-black/30'}`}>
        <div className="glass-modal rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200 border border-white/70">
          <div className="px-6 py-4 border-b border-white/60 flex justify-between items-center bg-white/30 flex-shrink-0">
            <h3 className="font-bold text-lg text-slate-800">{mode === 'edit' ? 'Modifica Intervento' : 'Nuovo Intervento'}</h3>
            <button onClick={onClose} className="glass-chip border border-white/70 rounded-full p-2 text-slate-500 hover:text-slate-800 transition">
              <X className="w-5 h-5" />
            </button>
          </div>

          <form id="intervention-form" onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-6 overflow-y-auto">

            {/* SEZIONE: DATI INTERVENTO */}
            <div className="space-y-4">
              <h4 className="font-bold text-slate-800 border-b glass-divider pb-2">1. Dettagli Intervento</h4>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Titolo (Obblig.)</label>
                  <input {...register('title')} className="w-full glass-input rounded-2xl px-3 py-2 text-sm text-slate-700 focus:ring-2 focus:ring-brand-400/40 outline-none" placeholder="Es. Riparazione Tubo" />
                  {errors.title && <p className="text-red-500 text-xs mt-1">{errors.title.message}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Indirizzo (Obblig.)</label>
                  <input {...register('address')} className="w-full glass-input rounded-2xl px-3 py-2 text-sm text-slate-700 focus:ring-2 focus:ring-brand-400/40 outline-none" placeholder="Via Roma 1, Milano" />
                  {errors.address && <p className="text-red-500 text-xs mt-1">{errors.address.message}</p>}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Priorità</label>
                  <select {...register('priority')} className="w-full glass-input rounded-2xl px-3 py-2 text-sm text-slate-700 focus:ring-2 focus:ring-brand-400/40 outline-none bg-white/60">
                    <option value="LOW">Bassa</option>
                    <option value="MEDIUM">Media</option>
                    <option value="HIGH">Alta</option>
                    <option value="URGENT">Urgente</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Squadra Assegnata</label>
                  <select {...register('technicianId')} className="w-full glass-input rounded-2xl px-3 py-2 text-sm text-slate-700 focus:ring-2 focus:ring-brand-400/40 outline-none bg-white/60">
                    <option value="">{effectiveTeams.length === 0 ? '-- Nessuna squadra disponibile --' : '-- Da Pianificare (Backlog) --'}</option>
                    {effectiveTeams.map(team => (
                      <option key={team.id} value={team.id}>{team.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Data Intervento</label>
                  <input type="date" {...register('scheduledDate')} className="w-full glass-input rounded-2xl px-3 py-2 text-sm text-slate-700 focus:ring-2 focus:ring-brand-400/40 outline-none bg-white/60" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1 text-center">Ora Inizio</label>
                  <input type="hidden" {...startTimeField} />
                  <div className="grid grid-cols-2 gap-2 items-center">
                    <select
                      value={startTimeParts.hour}
                      onChange={(event) => {
                        const nextHour = event.target.value;
                        const minute = startTimeParts.minute || '00';
                        setQuarterTimeValue('startTime', nextHour, minute);
                      }}
                      className="w-full glass-input rounded-2xl px-3 py-2 text-sm text-slate-700 focus:ring-2 focus:ring-brand-400/40 outline-none bg-white/60"
                    >
                      <option value="">--</option>
                      {HOUR_OPTIONS.map(hour => (
                        <option key={`start-hour-${hour}`} value={hour}>{hour}</option>
                      ))}
                    </select>
                    <select
                      value={startTimeParts.minute}
                      onChange={(event) => {
                        const nextMinute = event.target.value;
                        const hour = startTimeParts.hour || '00';
                        setQuarterTimeValue('startTime', hour, nextMinute);
                      }}
                      className="w-full glass-input rounded-2xl px-3 py-2 text-sm text-slate-700 focus:ring-2 focus:ring-brand-400/40 outline-none bg-white/60"
                    >
                      <option value="">--</option>
                      {QUARTER_MINUTE_OPTIONS.map(minute => (
                        <option key={`start-minute-${minute}`} value={minute}>{minute}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1 text-center">Ora Fine</label>
                  <input type="hidden" {...endTimeField} />
                  <div className="grid grid-cols-2 gap-2 items-center">
                    <select
                      value={endTimeParts.hour}
                      onChange={(event) => {
                        const nextHour = event.target.value;
                        const minute = endTimeParts.minute || '00';
                        setQuarterTimeValue('endTime', nextHour, minute);
                      }}
                      className="w-full glass-input rounded-2xl px-3 py-2 text-sm text-slate-700 focus:ring-2 focus:ring-brand-400/40 outline-none bg-white/60"
                    >
                      <option value="">--</option>
                      {HOUR_OPTIONS.map(hour => (
                        <option key={`end-hour-${hour}`} value={hour}>{hour}</option>
                      ))}
                    </select>
                    <select
                      value={endTimeParts.minute}
                      onChange={(event) => {
                        const nextMinute = event.target.value;
                        const hour = endTimeParts.hour || '00';
                        setQuarterTimeValue('endTime', hour, nextMinute);
                      }}
                      className="w-full glass-input rounded-2xl px-3 py-2 text-sm text-slate-700 focus:ring-2 focus:ring-brand-400/40 outline-none bg-white/60"
                    >
                      <option value="">--</option>
                      {QUARTER_MINUTE_OPTIONS.map(minute => (
                        <option key={`end-minute-${minute}`} value={minute}>{minute}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
              <p className="text-[11px] text-slate-500">Gli orari vengono normalizzati su intervalli di 15 minuti al salvataggio.</p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Seconda Squadra (Opzionale)</label>
                  <select {...register('secondaryTechnicianId')} className="w-full glass-input rounded-2xl px-3 py-2 text-sm text-slate-700 focus:ring-2 focus:ring-brand-400/40 outline-none bg-white/60">
                    <option value="">{effectiveTeams.length === 0 ? '-- Nessuna squadra disponibile --' : '-- Nessuna --'}</option>
                    {effectiveTeams.map(team => (
                      <option key={team.id} value={team.id}>{team.name}</option>
                    ))}
                  </select>
                  <p className="text-[11px] text-slate-500 mt-1">Utile quando servono due squadre.</p>
                </div>
                <div className="glass-card border border-white/70 rounded-2xl p-3 text-xs text-slate-600 flex items-center">
                  Nota: in calendario l'intervento viene mostrato sulla squadra principale. La seconda squadra vedrà comunque l'intervento assegnato.
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Descrizione Lavoro</label>
                <textarea {...register('description')} rows={2} className="w-full glass-input rounded-2xl px-3 py-2 text-sm text-slate-700 focus:ring-2 focus:ring-brand-400/40 outline-none" placeholder="Dettagli aggiuntivi..." />
              </div>

              <div className="pt-2 border-t glass-divider">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <label className="block text-sm font-medium text-slate-700">Allega file</label>
                  {uploadingAdminAttachments && <span className="text-xs text-brand-600">Upload in corso...</span>}
                </div>
                <div className="border border-dashed border-white/60 rounded-2xl p-4 bg-white/30">
                  <label className="flex items-center justify-center gap-2 cursor-pointer text-sm text-slate-700 font-medium">
                    <UploadCloud className="w-5 h-5 text-slate-400" />
                    <span>{mode === 'edit' ? 'Carica allegati' : 'Seleziona allegati (saranno caricati dopo il salvataggio)'}</span>
                    <input
                      type="file"
                      multiple
                      accept="audio/*,video/*,image/*,application/pdf,application/*"
                      className="hidden"
                      onChange={handleAdminAttachmentChange}
                      disabled={uploadingAdminAttachments}
                    />
                  </label>
                  <p className="mt-2 text-xs text-slate-500">
                    Formati consentiti: PNG/JPG/WEBP/GIF, MP4/MOV, PDF, audio (mp3/wav/webm/ogg/mp4). Dimensione massima: {ATTACHMENT_MAX_SIZE_MB}MB.
                  </p>
                  {mode === 'create' && (
                    <p className="text-[11px] text-slate-500 mt-2">
                      In creazione gli allegati vengono messi in coda e caricati automaticamente dopo il salvataggio.
                    </p>
                  )}
                </div>

                {loadingAdminAttachments && adminAttachments.length === 0 && (
                  <div className="text-xs text-slate-500 mt-2">Caricamento allegati...</div>
                )}

                {pendingAdminFiles.length > 0 && (
                  <div className="mt-3 space-y-2">
                    <div className="text-xs font-semibold text-slate-500 uppercase">In coda</div>
                    {pendingAdminFiles.map((file, index) => (
                      <div key={`${file.name}-${index}`} className="flex items-center justify-between bg-white/60 px-3 py-2 rounded-xl border border-white/70">
                        <div className="min-w-0 flex items-center gap-2">
                          <Paperclip className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                          <span className="text-xs text-slate-700 truncate">{file.name}</span>
                        </div>
                        <button type="button" onClick={() => removePendingAdminFile(index)} className="text-red-400 hover:text-red-600">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {adminAttachments.length > 0 && (
                  <div className="mt-3 space-y-2">
                    <div className="text-xs font-semibold text-slate-500 uppercase">Già caricati</div>
                    {adminAttachments.map(att => (
                      <a
                        key={att.id}
                        href={att.downloadUrl || `/api/attachments/${att.id}/download`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-between bg-white/60 px-3 py-2 rounded-xl border border-white/70 hover:bg-white/80 transition"
                      >
                        <div className="min-w-0 flex items-center gap-2">
                          <Paperclip className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                          <span className="text-xs text-slate-700 truncate">{att.originalName}</span>
                        </div>
                        <span className="text-[11px] text-slate-500">{Math.max(1, Math.round(att.size / 1024))} KB</span>
                      </a>
                    ))}
                  </div>
                )}
              </div>

              <div className="pt-2 border-t glass-divider">
                <label className="block text-sm font-medium text-slate-700 mb-2">Registra audio</label>
                <div className="rounded-2xl border border-white/70 bg-white/40 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs text-slate-600">La registrazione viene salvata nello stesso elenco allegati.</p>
                    {isRecordingAudio ? (
                      <button
                        type="button"
                        onClick={stopActiveRecording}
                        className="inline-flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100"
                      >
                        <Square className="h-4 w-4" />
                        Ferma
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => { void startAudioRecording(); }}
                        disabled={uploadingAdminAttachments}
                        className="inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/80 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-white disabled:opacity-60"
                      >
                        <Mic className="h-4 w-4" />
                        Registra
                      </button>
                    )}
                  </div>
                  <div className="mt-2 text-xs text-slate-600">
                    {isRecordingAudio ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
                        Registrazione in corso: {formatRecordingDuration(recordingSeconds)}
                      </span>
                    ) : (
                      <span>Pronto per registrare.</span>
                    )}
                  </div>
                  {audioRecorderError && (
                    <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                      {audioRecorderError}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* SEZIONE: CLIENTE */}
            <div className="space-y-4 bg-white/30 p-4 rounded-2xl border border-white/60">
              <h4 className="font-bold text-slate-800 flex items-center justify-between pb-2 border-b glass-divider">
                <span>2. Anagrafica e Cliente</span>
              </h4>

              <div className="relative" ref={searchRef}>
                <label className="block text-sm font-medium text-slate-700 mb-1">Seleziona in Anagrafica (Opzionale)</label>
                <div className="flex items-center gap-2">
                  <div className="relative w-full">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={customerSearch}
                      onChange={handleManualTyping}
                      onFocus={() => { if (customers.length > 0) setShowSearchDropdown(true) }}
                      placeholder="Cerca cliente per nome, telefono..."
                      className="w-full glass-input rounded-2xl pl-9 pr-8 py-2 text-sm text-slate-700 focus:ring-2 focus:ring-brand-400/40 outline-none shadow-sm transition"
                    />
                    {customerSearch && (
                      <button type="button" onClick={clearCustomerLink} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-red-500 transition">
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                {showSearchDropdown && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white/80 border border-white/70 shadow-xl rounded-2xl max-h-60 overflow-y-auto z-10 p-1 backdrop-blur">
                    {isSearching ? (
                      <div className="p-3 text-sm text-center text-slate-500">Ricerca...</div>
                    ) : customers.length === 0 ? (
                      <div className="p-3 text-sm text-center text-slate-500">Nessun cliente trovato</div>
                    ) : (
                      customers.map(c => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => selectCustomer(c)}
                          className="w-full text-left p-2 hover:bg-white/70 rounded-xl transition flex flex-col gap-1 border-b border-white/40 last:border-0"
                        >
                          <div className="font-semibold text-slate-800 text-sm flex items-center gap-2">
                            {c.companyName ? <Building2 className="w-3 h-3 text-slate-400" /> : <User className="w-3 h-3 text-slate-400" />}
                            {c.name}
                          </div>
                          <div className="text-xs text-slate-500 flex items-center gap-2">
                            {c.email && <span>{c.email}</span>}
                            {(c.phone1 || c.phone2 || c.phone) && <span>{[c.phone1, c.phone2, c.phone].filter(Boolean).join(' / ')}</span>}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>

              {selectedCustomerId && (
                <div className="glass-card border border-white/70 rounded-2xl p-3 space-y-2">
                  <label className="block text-sm font-medium text-slate-700">Indirizzo cliente</label>
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-center">
                    <div className="rounded-2xl border border-white/70 bg-white/60 px-3 py-2 text-sm text-slate-600 min-h-[42px]">
                      {selectedCustomer?.addressLine || selectedCustomer?.physicalAddress || 'Nessun indirizzo salvato in anagrafica'}
                    </div>
                    <button
                      type="button"
                      onClick={handleUseCompanyAddress}
                      disabled={!selectedCustomer?.addressLine && !selectedCustomer?.physicalAddress}
                      className="btn-secondary glass-chip text-sm disabled:opacity-50"
                    >
                      Usa indirizzo cliente
                    </button>
                  </div>
                  <p className="text-xs text-slate-500">La commessa non è richiesta in questa fase: crea direttamente l&apos;intervento.</p>
                </div>
              )}

              {/* Dati Cliente Sull'intervento */}
              <div className="pt-2">
                <p className="text-xs font-semibold text-slate-500 uppercase mb-3">Oppure inserisci manualmente i riferimenti per questo intervento:</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                  <div>
                    <input {...register('customerNameSnapshot')} className="w-full glass-input rounded-2xl px-3 py-2 text-sm focus:ring-1 focus:ring-brand-400/40 outline-none" placeholder="Nome Cliente (Es. Condominio Le Vele)" />
                  </div>
                  <div>
                    <input {...register('customerEmailSnapshot')} type="email" className="w-full glass-input rounded-2xl px-3 py-2 text-sm focus:ring-1 focus:ring-brand-400/40 outline-none" placeholder="Email (Es. info@le-vele.it)" />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <input {...register('customerPhoneSnapshot')} type="tel" className="w-full glass-input rounded-2xl px-3 py-2 text-sm focus:ring-1 focus:ring-brand-400/40 outline-none" placeholder="Telefono (Es. 011 2233)" />
                      <button
                        type="button"
                        onClick={() => { void handleCopyPhone(customerPhoneSnapshotValue); }}
                        aria-label="Copia numero"
                        className="inline-flex items-center justify-center rounded-xl border border-white/70 bg-white/70 px-2.5 py-2 text-slate-500 hover:text-slate-700 transition"
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <div>
                    <input {...register('customerAddressSnapshot')} className="w-full glass-input rounded-2xl px-3 py-2 text-sm focus:ring-1 focus:ring-brand-400/40 outline-none" placeholder="Dettaglio Indirizzo Cliente" />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                  <div>
                    <input {...register('customerTaxCodeSnapshot')} className="w-full glass-input rounded-2xl px-3 py-2 text-sm focus:ring-1 focus:ring-brand-400/40 outline-none" placeholder="Codice fiscale (Opzionale)" />
                  </div>
                  <div>
                    <input {...register('customerVatNumberSnapshot')} className="w-full glass-input rounded-2xl px-3 py-2 text-sm focus:ring-1 focus:ring-brand-400/40 outline-none" placeholder="Partita IVA (Opzionale)" />
                  </div>
                </div>
              </div>
            </div>

          </form>

          <div className="px-6 py-4 bg-white/30 border-t border-white/60 flex justify-end gap-3 flex-shrink-0">
            <button type="button" onClick={onClose} className="btn-secondary glass-chip">Annulla</button>
            <button form="intervention-form" type="submit" disabled={isSubmitting} className="btn-primary disabled:opacity-50">
              {isSubmitting ? 'Salvataggio...' : (mode === 'edit' ? 'Salva Modifiche' : 'Crea Intervento')}
            </button>
          </div>
        </div>
      </div>

      {/* CRM AUTO-ADD POPUP */}
      {showCRMConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="glass-modal rounded-3xl shadow-2xl max-w-sm w-full p-6 text-center animate-in zoom-in-95 border border-white/70">
            <div className="w-16 h-16 bg-brand-50 text-brand-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <Building2 className="w-8 h-8" />
            </div>
            <h3 className="text-xl font-bold text-slate-800 mb-2">Salva in Anagrafica?</h3>
            <p className="text-slate-600 text-sm mb-6 leading-relaxed">
              Hai inserito manualmente i dati di <strong>{pendingFormData?.customerNameSnapshot}</strong> che non risulta in anagrafica.<br /><br />Vuoi aggiungere questo cliente per i prossimi interventi?
            </p>
            <div className="flex flex-col gap-2">
              <button onClick={handleCRMConfirmYes} className="w-full bg-brand-600 text-white font-bold py-3 rounded-xl shadow-sm hover:bg-brand-700 transition">
                Sì, aggiungi all'anagrafica
              </button>
              <button onClick={handleCRMConfirmNo} className="w-full bg-slate-100 text-slate-700 font-bold py-3 rounded-xl hover:bg-slate-200 transition">
                No, salva solo per quest'intervento
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AttachmentRecord, Intervention, Technician } from '../types';
import type { WorkReport } from '../types';
import { useAuth } from '../context/AuthContext';
import { Loader2, Save, X } from 'lucide-react';
import { apiFetch } from '../lib/apiFetch';
import { toast } from './Toast';
import { useModalRegistration } from './ModalStackProvider';
import { normalizeAddress } from '../lib/normalizeAddress';
import { useWorkReportSave } from '../features/workreport/useWorkReportSave';
import WorkReportCloseConfirm from '../features/workreport/components/WorkReportCloseConfirm';
import WorkReportFormStep, { type AddressHistoryItem } from '../features/workreport/components/WorkReportFormStep';
import WorkReportSendStep from '../features/workreport/components/WorkReportSendStep';
import WorkReportSignStep from '../features/workreport/components/WorkReportSignStep';
import WorkReportStatusBanner from '../features/workreport/components/WorkReportStatusBanner';

interface Props {
  intervention: Intervention & { technician?: Technician; workReport?: WorkReport };
  onClose: () => void;
  onRefresh: () => void;
}

type StepKey = 'form' | 'sign' | 'send';
const WORK_REPORT_EMAIL_ENABLED = import.meta.env.VITE_WORK_REPORT_EMAIL_ENABLED === 'true';
const ATTACHMENT_MAX_SIZE_MB = Number(import.meta.env.VITE_ATTACHMENT_MAX_FILE_SIZE_MB || 15);
const MAX_MANUAL_ACTUAL_MINUTES = 10_080;

function getInterventionStatusLabel(status?: string) {
  if (status === 'SCHEDULED') return 'PIANIFICATO';
  if (status === 'IN_PROGRESS') return 'IN CORSO';
  if (status === 'COMPLETED') return 'COMPLETATO';
  if (status === 'FAILED') return 'FALLITO';
  if (status === 'CANCELLED') return 'ANNULLATO';
  if (status === 'NO_SHOW') return 'CLIENTE ASSENTE';
  return status || 'INTERVENTO';
}

export default function WorkReportModal({ intervention, onClose, onRefresh }: Props) {
  const { user } = useAuth();
  const {
    values,
    setField,
    isLoadingReport: loading,
    isSaving: isSaveInFlight,
    report,
    pendingDraftOffer,
    acceptDraft,
    discardDraft,
    saveLifecycle,
    statusLabel,
    saveNow,
    retry,
    refreshFromServer,
    beforeClose
  } = useWorkReportSave({
    interventionId: intervention.id,
    userId: user?.id ?? null
  });

  const [actionLoading, setActionLoading] = useState(false);
  const [activeStep, setActiveStep] = useState<StepKey>('form');
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [closeConfirmAction, setCloseConfirmAction] = useState<'retry' | null>(null);
  const [closeConfirmMode, setCloseConfirmMode] = useState<'default' | 'syncing'>('default');
  const [signStepHint, setSignStepHint] = useState<string | null>(null);
  const [showOptionalDetails, setShowOptionalDetails] = useState(false);
  const [interventionAttachments, setInterventionAttachments] = useState<AttachmentRecord[]>([]);
  const [reportAttachments, setReportAttachments] = useState<AttachmentRecord[]>([]);
  const [attachmentsLoading, setAttachmentsLoading] = useState(false);
  const [attachmentsUploading, setAttachmentsUploading] = useState(false);
  const [openingAttachmentId, setOpeningAttachmentId] = useState<string | null>(null);
  const [isRecordingAudio, setIsRecordingAudio] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [audioRecorderError, setAudioRecorderError] = useState<string | null>(null);
  const [showAddressHistory, setShowAddressHistory] = useState(false);
  const [addressHistoryLoading, setAddressHistoryLoading] = useState(false);
  const [addressHistoryError, setAddressHistoryError] = useState<string | null>(null);
  const [addressHistoryItems, setAddressHistoryItems] = useState<AddressHistoryItem[]>([]);
  const [manualActualMinutesInput, setManualActualMinutesInput] = useState('0');
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const workPerformedRef = useRef<HTMLTextAreaElement | null>(null);
  const closeConfirmPrimaryRef = useRef<HTMLButtonElement | null>(null);
  const primaryActionInFlightRef = useRef(false);
  const addressHistoryLoadedRef = useRef(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<BlobPart[]>([]);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingTimerRef = useRef<number | null>(null);
  const normalizedAddressKey = useMemo(() => normalizeAddress(intervention.address || ''), [intervention.address]);
  const saving = actionLoading || isSaveInFlight;

  const getCommonApiErrorToastMessage = useCallback((status: number, apiError?: string, fallback = 'Operazione non riuscita') => {
    if (status === 413) return 'File troppo grande o troppi file.';
    if (status === 415) return 'Tipo file non supportato. Carica immagini, video, PDF o audio consentiti.';
    if (status === 429) return 'Troppi upload. Attendi qualche secondo e riprova.';
    if (apiError) return apiError;
    if (status === 401) return 'Sessione scaduta. Effettua di nuovo il login.';
    if (status === 403) return 'Non hai i permessi per questa operazione.';
    if (status === 409) return 'Conflitto dati: aggiorna e riprova.';
    return fallback;
  }, []);

  const refreshReportAttachments = useCallback(async () => {
    setAttachmentsLoading(true);
    try {
      const res = await apiFetch(`/api/interventions/${intervention.id}/details`);
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        const apiError = typeof payload?.error === 'string' ? payload.error : '';
        toast.error(getCommonApiErrorToastMessage(res.status, apiError, 'Errore caricamento allegati'));
        return;
      }
      const details = await res.json().catch(() => null);
      const interventionList = Array.isArray(details?.attachments) ? details.attachments : [];
      const reportList = Array.isArray(details?.workReport?.attachments) ? details.workReport.attachments : [];
      setInterventionAttachments(interventionList);
      setReportAttachments(reportList);
    } catch (error) {
      console.error(error);
      toast.error('Errore caricamento allegati');
    } finally {
      setAttachmentsLoading(false);
    }
  }, [intervention.id]);

  const allAttachments = useMemo(() => {
    const merged = new Map<string, AttachmentRecord>();
    for (const attachment of [...reportAttachments, ...interventionAttachments]) {
      merged.set(attachment.id, attachment);
    }
    return Array.from(merged.values()).sort((a, b) => {
      const aTs = new Date(a.createdAt || 0).getTime();
      const bTs = new Date(b.createdAt || 0).getTime();
      return bTs - aTs;
    });
  }, [interventionAttachments, reportAttachments]);

  useEffect(() => {
    refreshReportAttachments();
  }, [refreshReportAttachments]);

  useEffect(() => {
    const nextMinutes = typeof report?.actualMinutes === 'number' && Number.isFinite(report.actualMinutes)
      ? report.actualMinutes
      : 0;
    setManualActualMinutesInput(String(nextMinutes));
  }, [report?.actualMinutes, report?.id]);

  useEffect(() => {
    addressHistoryLoadedRef.current = false;
    setShowAddressHistory(false);
    setAddressHistoryError(null);
    setAddressHistoryItems([]);
  }, [intervention.id]);

  useEffect(() => {
    if (!WORK_REPORT_EMAIL_ENABLED && activeStep === 'send') {
      setActiveStep('sign');
    }
  }, [activeStep]);

  useEffect(() => {
    if (activeStep !== 'sign') {
      setSignStepHint(null);
    }
  }, [activeStep]);

  useEffect(() => {
    if (!closeConfirmOpen) return;
    requestAnimationFrame(() => {
      closeConfirmPrimaryRef.current?.focus();
    });
  }, [closeConfirmOpen]);

  useEffect(() => {
    return () => {
      if (recordingTimerRef.current !== null) {
        window.clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      if (mediaRecorderRef.current) {
        mediaRecorderRef.current.ondataavailable = null;
        mediaRecorderRef.current.onstop = null;
        mediaRecorderRef.current.onerror = null;
        try {
          if (mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
          }
        } catch {
          // ignore recorder stop errors on unmount
        }
        mediaRecorderRef.current = null;
      }
      if (recordingStreamRef.current) {
        for (const track of recordingStreamRef.current.getTracks()) {
          track.stop();
        }
        recordingStreamRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
      beforeClose();
      requestAnimationFrame(() => {
        previousFocusRef.current?.focus();
      });
    };
  }, [beforeClose]);

  const completeClose = useCallback(() => {
    onRefresh();
    onClose();
  }, [onClose, onRefresh]);

  const attemptClose = useCallback(() => {
    if (saveLifecycle.state === 'SYNCING' && !saveLifecycle.lastLocalSavedAt) {
      setCloseConfirmMode('syncing');
      setCloseConfirmOpen(true);
      return;
    }

    const requiresConfirm =
      saveLifecycle.state === 'DIRTY' ||
      saveLifecycle.state === 'FAILED' ||
      saveLifecycle.state === 'CONFLICT' ||
      (
        saveLifecycle.dirtyFieldsCount > 0 &&
        saveLifecycle.state !== 'LOCAL_SAVED' &&
        saveLifecycle.state !== 'QUEUED'
      );

    if (requiresConfirm) {
      setCloseConfirmMode('default');
      setCloseConfirmOpen(true);
      return;
    }

    const closeCheck = beforeClose();
    if (!closeCheck.canClose) {
      toast.error('Impossibile salvare la bozza prima della chiusura.');
      return;
    }

    completeClose();
  }, [beforeClose, completeClose, saveLifecycle.dirtyFieldsCount, saveLifecycle.lastLocalSavedAt, saveLifecycle.state]);

  const handleRestoreDraft = () => {
    acceptDraft();
  };

  const handleIgnoreDraft = () => {
    discardDraft();
  };

  const handleCloseWithLocalSave = useCallback(() => {
    const closeCheck = beforeClose();
    if (!closeCheck.canClose) {
      toast.error('Impossibile salvare la bozza prima della chiusura.');
      return;
    }
    setCloseConfirmOpen(false);
    completeClose();
  }, [beforeClose, completeClose]);

  const handleCloseWithRetry = useCallback(async () => {
    if (closeConfirmAction) return;
    setCloseConfirmAction('retry');
    const result = await saveNow();
    if (result.outcome === 'SYNCED' || result.outcome === 'QUEUED') {
      setCloseConfirmAction(null);
      setCloseConfirmOpen(false);
      completeClose();
      return;
    }
    if (result.outcome === 'CONFLICT') {
      toast.error(result.message || 'Conflitto dati: aggiorna e riprova.');
    } else {
      toast.error(result.message || 'Errore salvataggio');
    }
    setCloseConfirmOpen(false);
    setCloseConfirmAction(null);
  }, [closeConfirmAction, completeClose, saveNow]);

  const loadAddressHistory = useCallback(async () => {
    if (!intervention.customerId || !normalizedAddressKey) {
      addressHistoryLoadedRef.current = true;
      setAddressHistoryItems([]);
      setAddressHistoryError(null);
      return;
    }
    setAddressHistoryLoading(true);
    setAddressHistoryError(null);
    try {
      // Lazy fetch: avoid extra API load until the operator explicitly opens this section.
      const qs = new URLSearchParams({
        customerId: intervention.customerId,
        addressKey: normalizedAddressKey,
        limit: '20'
      });
      const res = await apiFetch(`/api/interventions/history-by-address?${qs.toString()}`);
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        const apiError = typeof payload?.error === 'string' ? payload.error : '';
        setAddressHistoryError(getCommonApiErrorToastMessage(res.status, apiError, 'Errore caricamento storico indirizzo'));
        return;
      }
      const payload = await res.json().catch(() => []);
      const list = Array.isArray(payload) ? payload as AddressHistoryItem[] : [];
      setAddressHistoryItems(list.filter((item) => item?.intervention?.id !== intervention.id));
      addressHistoryLoadedRef.current = true;
    } catch {
      setAddressHistoryError('Errore caricamento storico indirizzo');
    } finally {
      setAddressHistoryLoading(false);
    }
  }, [getCommonApiErrorToastMessage, intervention.customerId, intervention.id, normalizedAddressKey]);

  useEffect(() => {
    if (!showAddressHistory || addressHistoryLoadedRef.current) return;
    void loadAddressHistory();
  }, [loadAddressHistory, showAddressHistory]);

  const uploadFilesToWorkReport = useCallback(async (selectedFiles: File[]) => {
    if (selectedFiles.length === 0) return;
    let workReportId = report?.id;
    if (!workReportId) {
      const latestReport = await refreshFromServer({ syncValues: false });
      workReportId = latestReport?.id;
    }
    if (!workReportId) {
      toast.error('Impossibile identificare la bolla per il caricamento allegati');
      return;
    }

    setAttachmentsUploading(true);
    try {
      const formData = new FormData();
      for (const file of selectedFiles) {
        formData.append('files', file);
      }

      const res = await apiFetch(`/api/work-reports/${workReportId}/attachments`, {
        method: 'POST',
        body: formData
      });
      const payload = await res.json().catch(() => null);

      if (!res.ok) {
        const apiError = typeof payload?.error === 'string' ? payload.error : '';
        toast.error(getCommonApiErrorToastMessage(res.status, apiError, 'Errore upload allegati'));
        return;
      }

      const created = Array.isArray(payload?.attachments) ? (payload.attachments as AttachmentRecord[]) : [];
      if (created.length > 0) {
        setReportAttachments(prev => [...created, ...prev]);
      } else {
        await refreshReportAttachments();
      }
      toast.success('Allegati caricati');
    } catch (error) {
      console.error(error);
      toast.error('Errore upload allegati');
    } finally {
      setAttachmentsUploading(false);
    }
  }, [refreshFromServer, refreshReportAttachments, report?.id]);

  const handleReportAttachmentsUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files || []);
    if (event.target) {
      event.target.value = '';
    }
    await uploadFilesToWorkReport(selectedFiles);
  };

  const stopRecordingTimer = () => {
    if (recordingTimerRef.current !== null) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  };

  const stopActiveRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;
    if (recorder.state === 'recording') {
      recorder.stop();
      return;
    }
    stopRecordingTimer();
    setIsRecordingAudio(false);
    setRecordingSeconds(0);
  };

  const startAudioRecording = async () => {
    if (isRecordingAudio || attachmentsUploading) return;
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
        setIsRecordingAudio(false);
        if (recordingStreamRef.current) {
          for (const track of recordingStreamRef.current.getTracks()) {
            track.stop();
          }
          recordingStreamRef.current = null;
        }
        mediaRecorderRef.current = null;
      };

      recorder.onstop = async () => {
        stopRecordingTimer();
        setIsRecordingAudio(false);
        setRecordingSeconds(0);

        const chunks = recordingChunksRef.current;
        recordingChunksRef.current = [];

        if (recordingStreamRef.current) {
          for (const track of recordingStreamRef.current.getTracks()) {
            track.stop();
          }
          recordingStreamRef.current = null;
        }
        mediaRecorderRef.current = null;

        if (chunks.length === 0) return;

        const mimeType = recorder.mimeType || 'audio/webm';
        const extension = mimeType.includes('mp4') ? 'm4a' : mimeType.includes('ogg') ? 'ogg' : 'webm';
        const fileName = `bolla-audio-${intervention.id}-${Date.now()}.${extension}`;
        const blob = new Blob(chunks, { type: mimeType });
        const audioFile = new File([blob], fileName, { type: mimeType });
        await uploadFilesToWorkReport([audioFile]);
      };

      recorder.start();
      setIsRecordingAudio(true);
      setRecordingSeconds(0);
      recordingTimerRef.current = window.setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } catch (error) {
      console.error(error);
      setAudioRecorderError('Impossibile avviare la registrazione audio. Controlla i permessi microfono.');
      stopRecordingTimer();
      setIsRecordingAudio(false);
      if (recordingStreamRef.current) {
        for (const track of recordingStreamRef.current.getTracks()) {
          track.stop();
        }
        recordingStreamRef.current = null;
      }
      mediaRecorderRef.current = null;
    }
  };

  const handleOpenAttachment = async (attachment: AttachmentRecord) => {
    if (openingAttachmentId === attachment.id) return;
    setOpeningAttachmentId(attachment.id);
    try {
      const url = attachment.downloadUrl || `/api/attachments/${attachment.id}/download`;
      const res = await apiFetch(url);
      const payload = await res.clone().json().catch(() => null);
      if (!res.ok) {
        const apiError = typeof payload?.error === 'string' ? payload.error : '';
        toast.error(getCommonApiErrorToastMessage(res.status, apiError, 'Errore apertura allegato'));
        return;
      }

      const blob = await res.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const opened = window.open(blobUrl, '_blank', 'noopener,noreferrer');
      if (!opened) {
        const downloadLink = document.createElement('a');
        downloadLink.href = blobUrl;
        downloadLink.download = attachment.originalName || 'allegato';
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);
      }
      window.setTimeout(() => {
        window.URL.revokeObjectURL(blobUrl);
      }, 60_000);
    } catch (error) {
      console.error(error);
      toast.error('Errore apertura allegato');
    } finally {
      setOpeningAttachmentId((current) => (current === attachment.id ? null : current));
    }
  };

  const normalizeManualActualMinutesInput = useCallback((input: string) => {
    const trimmed = input.trim();
    if (!trimmed) return 0;
    const parsed = Number(trimmed.replace(',', '.'));
    if (!Number.isFinite(parsed)) return null;
    const normalized = Math.round(parsed);
    if (!Number.isInteger(normalized)) return null;
    if (normalized < 0 || normalized > MAX_MANUAL_ACTUAL_MINUTES) return null;
    return normalized;
  }, []);

  const persistManualActualMinutes = useCallback(async () => {
    const normalizedMinutes = normalizeManualActualMinutesInput(manualActualMinutesInput);
    if (normalizedMinutes === null) {
      toast.error(`Durata non valida. Inserisci un valore tra 0 e ${MAX_MANUAL_ACTUAL_MINUTES} minuti.`);
      return false;
    }

    if (manualActualMinutesInput.trim() !== String(normalizedMinutes)) {
      setManualActualMinutesInput(String(normalizedMinutes));
    }

    if (!report?.id) return true;
    if (normalizedMinutes === (report.actualMinutes || 0)) return true;

    const version = report.version;
    if (!(typeof version === 'number' && Number.isInteger(version))) {
      toast.error('Versione bolla non disponibile. Aggiorna e riprova.');
      return false;
    }

    const res = await apiFetch(`/api/interventions/${intervention.id}/work-report`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version,
        actualMinutes: normalizedMinutes
      })
    });
    const payload = await res.json().catch(() => null);

    if (!res.ok) {
      const apiError = typeof payload?.error === 'string' ? payload.error : '';
      toast.error(getCommonApiErrorToastMessage(res.status, apiError, 'Errore salvataggio durata'));
      if (res.status === 409) {
        await refreshFromServer({ syncValues: false });
      }
      return false;
    }

    await refreshFromServer({ syncValues: false });
    return true;
  }, [getCommonApiErrorToastMessage, intervention.id, manualActualMinutesInput, normalizeManualActualMinutesInput, refreshFromServer, report]);

  const handleSaveForm = async () => {
    const minutesOk = await persistManualActualMinutes();
    if (!minutesOk) return;
    const result = await saveNow();
    if (result.outcome === 'SYNCED') {
      toast.success(result.message || 'Salvataggio completato!');
      onRefresh();
      return;
    }
    if (result.outcome === 'QUEUED') {
      toast.info(result.message || 'Rete non disponibile. Salvataggio messo in coda.');
      return;
    }
    if (result.outcome === 'CONFLICT') {
      toast.info(result.message || 'Conflitto versione: aggiorna i dati e riprova.');
      return;
    }
    toast.error(result.message || 'Errore salvataggio');
  };

  const generateSignLink = async () => {
    const closeCheck = beforeClose();
    if (!closeCheck.canClose) {
      toast.error('Impossibile salvare la bozza prima della generazione firma.');
      return;
    }
    setActionLoading(true);
    try {
      const res = await apiFetch(`/api/interventions/${intervention.id}/work-report/generate-sign-link`, {
        method: 'POST'
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        const apiError = typeof payload?.error === 'string' ? payload.error : '';
        toast.error(getCommonApiErrorToastMessage(res.status, apiError, 'Errore generazione link'));
        return;
      }
      await refreshFromServer({ syncValues: false });
      onRefresh();
      setSignStepHint('Link firma generato. Attendi la firma cliente e poi premi \"FIRMA E CHIUDI\".');
      toast.success('Link firma generato');
    } catch (e) {
      toast.error('Errore generazione link');
    } finally {
      setActionLoading(false);
    }
  };

  const handleSendEmail = async (): Promise<boolean> => {
    if (!values.customerEmail) {
      toast.error("Inserisci l'email del cliente prima di inviare");
      return false;
    }

    const closeCheck = beforeClose();
    if (!closeCheck.canClose) {
      toast.error('Impossibile salvare la bozza prima dell’invio email.');
      return false;
    }

    setActionLoading(true);
    try {
      const res = await apiFetch(`/api/interventions/${intervention.id}/work-report/send-email`, {
        method: 'POST'
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        const apiError = typeof payload?.error === 'string' ? payload.error : '';
        toast.error(getCommonApiErrorToastMessage(res.status, apiError, 'Errore invio email'));
        return false;
      }

      await refreshFromServer({ syncValues: false });
      onRefresh();
      toast.success('Email inviata con successo!');
      return true;
    } catch (e) {
      toast.error('Errore invio email');
      return false;
    } finally {
      setActionLoading(false);
    }
  };

  const refreshSignatureStatus = async () => {
    setActionLoading(true);
    try {
      const latest = await refreshFromServer({ syncValues: false });
      onRefresh();
      if (!latest?.signedAt) {
        toast.info('Firma non ancora completata.');
      } else {
        setSignStepHint(null);
      }
      return latest;
    } finally {
      setActionLoading(false);
    }
  };

  const signUrl = report?.signatureToken
    ? `${window.location.origin}/sign/${report.signatureToken}`
    : null;
  const isSigned = !!report?.signedAt;
  const isEmailed = !!report?.emailedAt;
  const reportNumber = report?.reportNumber ?? intervention.id;

  const workPerformedLength = values.workPerformed.trim().length;
  const normalizedManualActualMinutes = normalizeManualActualMinutesInput(manualActualMinutesInput);
  const manualActualMinutesForDisplay = normalizedManualActualMinutes ?? (report?.actualMinutes || 0);
  const workReportAttachmentsCount = reportAttachments.length;
  const emailValid = !!values.customerEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.customerEmail);
  const formatAttachmentKb = (size?: number) => `${Math.max(1, Math.round((size || 0) / 1024))} KB`;
  const formatRecordingDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const stepOrder: StepKey[] = WORK_REPORT_EMAIL_ENABLED ? ['form', 'sign', 'send'] : ['form', 'sign'];
  const stepLabels: Record<StepKey, string> = {
    form: 'Dettagli',
    sign: 'Firma',
    send: 'Invio'
  };
  const currentStepIndex = stepOrder.indexOf(activeStep);
  const progressPercent = ((currentStepIndex + 1) / stepOrder.length) * 100;

  const bubbleStatusLabel = !isSigned ? 'DA FIRMARE' : !isEmailed ? 'DA INVIARE' : 'INVIATA';
  const bubbleStatusClasses = !isSigned
    ? 'border-amber-200 bg-amber-50 text-amber-700'
    : !isEmailed
      ? 'border-sky-200 bg-sky-50 text-sky-700'
      : 'border-emerald-200 bg-emerald-50 text-emerald-700';

  const overlayMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (closeConfirmOpen) return;
    if (event.target === event.currentTarget) {
      attemptClose();
    }
  };

  const setStepWithDraftFlush = (nextStep: StepKey) => {
    if (saveLifecycle.state === 'CONFLICT') {
      toast.error('Conflitto dati attivo: aggiorna prima di cambiare step.');
      return;
    }
    const closeCheck = beforeClose();
    if (!closeCheck.canClose) {
      toast.error('Impossibile salvare la bozza prima del cambio step.');
      return;
    }
    setActiveStep(nextStep);
  };

  const handlePrimaryAction = async () => {
    if (primaryActionInFlightRef.current) return;
    primaryActionInFlightRef.current = true;
    try {
      if (activeStep === 'form') {
        const minutesOk = await persistManualActualMinutes();
        if (!minutesOk) return;
        setStepWithDraftFlush('sign');
        return;
      }

      if (activeStep === 'sign') {
        setSignStepHint(null);
        if (!signUrl) {
          setSignStepHint('Genera prima il link firma e fai firmare il cliente.');
          return;
        }
        let signedNow = isSigned;
        if (!signedNow) {
          const latest = await refreshSignatureStatus();
          signedNow = !!latest?.signedAt;
        }
        if (!signedNow) {
          setSignStepHint('Firma cliente non completata. Verifica il QR o il link di firma.');
          return;
        }

        const result = await saveNow();
        if (result.outcome === 'SYNCED') {
          toast.success(result.message || 'Bolla salvata e chiusa.');
          completeClose();
          return;
        }
        if (result.outcome === 'QUEUED') {
          toast.info(result.message || 'Rete non disponibile. Bolla in coda e chiusa.');
          completeClose();
          return;
        }
        if (result.outcome === 'CONFLICT') {
          setSignStepHint(result.message || 'Conflitto dati: usa Aggiorna e Riprova.');
          toast.error(result.message || 'Conflitto dati: usa Aggiorna e Riprova.');
          return;
        }
        setSignStepHint(result.message || 'Salvataggio non riuscito. Riprova.');
        toast.error(result.message || 'Errore salvataggio');
        return;
      }

      const sent = await handleSendEmail();
      if (sent) {
        completeClose();
      }
    } finally {
      primaryActionInFlightRef.current = false;
    }
  };

  const primaryLabel = (() => {
    if (activeStep === 'form') return 'AVANTI ALLA FIRMA';
    if (activeStep === 'sign') return 'FIRMA E CHIUDI';
    return 'INVIA E CHIUDI';
  })();

  const primaryDisabled =
    saving ||
    saveLifecycle.state === 'CONFLICT' ||
    (activeStep === 'send' && (!emailValid || !isSigned));

  const showSaveButton = activeStep === 'form';

  useModalRegistration({
    id: `work-report-modal-${intervention.id}`,
    isOpen: true,
    onClose: () => {
      attemptClose();
    },
    onPrimaryAction: () => {
      if (primaryDisabled) return;
      void handlePrimaryAction();
    },
    options: {
      closeOnEsc: !closeConfirmOpen,
      blockEscWhenEditing: false,
      priority: 260
    }
  });

  useModalRegistration({
    id: `work-report-close-confirm-${intervention.id}`,
    isOpen: closeConfirmOpen,
    onClose: () => {
      if (closeConfirmAction) return;
      setCloseConfirmOpen(false);
    },
    onPrimaryAction: () => {
      if (closeConfirmAction) return;
      handleCloseWithLocalSave();
    },
    options: {
      closeOnEsc: true,
      blockEscWhenEditing: false,
      priority: 280
    }
  });

  if (loading) {
    const loadingModal = (
      <div
        className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
        style={{ backgroundColor: 'rgba(0,0,0,0.8)' }}
      >
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-xl">
          Caricamento bolla...
        </div>
      </div>
    );
    return createPortal(loadingModal, document.body);
  }

  const modalContent = (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.82)' }}
      onMouseDown={overlayMouseDown}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="relative flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-slate-200 shadow-xl"
        style={{ backgroundColor: '#fff', color: '#0f172a' }}
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 border-b border-slate-200 bg-white px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h3 className="text-xl font-bold text-slate-900">Bolla #{reportNumber}</h3>
              <p className="mt-1 truncate text-sm text-slate-600">
                {intervention.title} · {intervention.address}
              </p>
              <div className="mt-3">
                <WorkReportStatusBanner
                  saveLifecycle={saveLifecycle}
                  statusLabel={statusLabel}
                  isSaving={saving}
                  helperMessage={saveLifecycle.state === 'SYNCING' ? 'Attendi invio... puoi continuare a lavorare.' : null}
                  onRetry={async () => {
                    const result = await retry();
                    if (result.outcome === 'SYNCED') {
                      toast.success(result.message || 'Sincronizzazione completata');
                      onRefresh();
                    } else if (result.outcome === 'QUEUED') {
                      toast.info(result.message || 'Bolla messa in coda');
                    } else if (result.outcome === 'CONFLICT') {
                      toast.error(result.message || 'Conflitto dati: aggiorna e ricontrolla.');
                    } else {
                      toast.error(result.message || 'Riprova non riuscita');
                    }
                  }}
                  onRefresh={async () => {
                    await refreshFromServer({ syncValues: false });
                    onRefresh();
                    toast.info('Dati aggiornati dal server');
                  }}
                  actionsDisabled={saving}
                />
              </div>
              <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                <span className="shrink-0 rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                  {getInterventionStatusLabel(intervention.status)}
                </span>
                <span
                  className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold ${bubbleStatusClasses}`}
                >
                  {bubbleStatusLabel}
                </span>
                <span className="shrink-0 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600">
                  Totale: {manualActualMinutesForDisplay} min
                </span>
              </div>
            </div>
            <button
              onClick={attemptClose}
              className="rounded-full border border-slate-200 bg-white p-3 text-slate-700 transition hover:bg-slate-50 hover:text-slate-900"
              aria-label="Chiudi bolla"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-800">
                Step {currentStepIndex + 1}/{stepOrder.length} · {stepLabels[activeStep]}
              </span>
              <span className="text-slate-500">{Math.round(progressPercent)}%</span>
            </div>
            <div className="h-2 rounded-full bg-slate-100">
              <div
                className="h-2 rounded-full bg-slate-900 transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          {pendingDraftOffer.exists && (
            <div className="mb-4 rounded-xl border border-orange-200 bg-orange-50 p-3">
              <p className="text-xs font-semibold text-orange-800">
                Trovata bozza salvata automaticamente
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleRestoreDraft}
                  className="motion-premium rounded-md border border-orange-300 bg-white px-3 py-1.5 text-xs font-semibold text-orange-800 hover:bg-orange-100"
                >
                  Ripristina
                </button>
                <button
                  type="button"
                  onClick={handleIgnoreDraft}
                  className="motion-premium rounded-md border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-semibold text-orange-700 hover:bg-orange-100"
                >
                  Ignora
                </button>
              </div>
            </div>
          )}

          {activeStep === 'form' && (
            <WorkReportFormStep
              values={values}
              manualActualMinutes={manualActualMinutesInput}
              workPerformedRef={workPerformedRef}
              workPerformedLength={workPerformedLength}
              workReportAttachmentsCount={workReportAttachmentsCount}
              onWorkPerformedChange={(value) => setField('workPerformed', value)}
              onManualActualMinutesChange={setManualActualMinutesInput}
              onManualActualMinutesBlur={() => { void persistManualActualMinutes(); }}
              showOptionalDetails={showOptionalDetails}
              onToggleOptionalDetails={() => setShowOptionalDetails(prev => !prev)}
              onExtraWorkChange={(value) => setField('extraWork', value)}
              onMaterialsChange={(value) => setField('materials', value)}
              allAttachments={allAttachments}
              attachmentsLoading={attachmentsLoading}
              attachmentsUploading={attachmentsUploading}
              openingAttachmentId={openingAttachmentId}
              onReportAttachmentsUpload={handleReportAttachmentsUpload}
              onOpenAttachment={handleOpenAttachment}
              formatAttachmentKb={formatAttachmentKb}
              attachmentMaxSizeMb={ATTACHMENT_MAX_SIZE_MB}
              isRecordingAudio={isRecordingAudio}
              recordingSeconds={recordingSeconds}
              audioRecorderError={audioRecorderError}
              onStartAudioRecording={startAudioRecording}
              onStopAudioRecording={stopActiveRecording}
              formatRecordingDuration={formatRecordingDuration}
              showAddressHistory={showAddressHistory}
              onToggleAddressHistory={() => setShowAddressHistory(prev => !prev)}
              hasAddressHistoryContext={Boolean(intervention.customerId && normalizedAddressKey)}
              addressHistoryLoading={addressHistoryLoading}
              addressHistoryError={addressHistoryError}
              addressHistoryItems={addressHistoryItems}
            />
          )}

          {activeStep === 'sign' && (
            <WorkReportSignStep
              isSigned={isSigned}
              customerSignatureDataUrl={report?.customerSignatureDataUrl}
              signUrl={signUrl}
              saving={saving}
              onShowSignatureInfo={() => toast.info('La firma viene acquisita dal cliente tramite link/QR.')}
              onGenerateSignLink={generateSignLink}
              onRefreshSignatureStatus={refreshSignatureStatus}
              showGoToSendButton={WORK_REPORT_EMAIL_ENABLED && isSigned}
              goToSendDisabled={saving || saveLifecycle.state === 'CONFLICT'}
              onGoToSend={() => { setStepWithDraftFlush('send'); }}
              signStepHint={signStepHint}
            />
          )}

          {WORK_REPORT_EMAIL_ENABLED && activeStep === 'send' && (
            <WorkReportSendStep
              customerEmail={values.customerEmail}
              customerName={values.customerName}
              onCustomerEmailChange={(value) => setField('customerEmail', value)}
              onCustomerNameChange={(value) => setField('customerName', value)}
              emailValid={emailValid}
              isSigned={isSigned}
              actualMinutes={manualActualMinutesForDisplay}
              emailedAt={report?.emailedAt}
            />
          )}
        </div>

        <div className="sticky bottom-0 border-t border-slate-200 bg-white px-5 py-4">
          <div className="space-y-2">
            {saveLifecycle.state === 'CONFLICT' && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Conflitto attivo: risolvi con \"Aggiorna\" o \"Riprova\" prima di procedere.
              </div>
            )}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              {showSaveButton ? (
                <button
                  onClick={handleSaveForm}
                  disabled={saving}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {saving ? 'Salvataggio...' : 'Salva'}
                </button>
              ) : (
                <div className="hidden sm:block" />
              )}

              <button
                onClick={handlePrimaryAction}
                disabled={primaryDisabled}
                className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {primaryLabel}
              </button>
            </div>
          </div>
        </div>

        <WorkReportCloseConfirm
          open={closeConfirmOpen}
          mode={closeConfirmMode}
          action={closeConfirmAction}
          primaryButtonRef={closeConfirmPrimaryRef}
          onRequestClose={() => setCloseConfirmOpen(false)}
          onSaveLocalAndClose={handleCloseWithLocalSave}
          onRetryNow={() => {
            void handleCloseWithRetry();
          }}
        />
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}

import { ChevronDown, ChevronRight, Clock, Loader2, Mic, Paperclip, Square, UploadCloud } from 'lucide-react';
import type { ChangeEvent, RefObject } from 'react';
import type { AttachmentRecord, WorkReport } from '../../../types';
import type { WorkReportDraftValues } from '../draftStorage';

export type AddressHistoryItem = {
  intervention: {
    id: number;
    title: string;
    startAt?: string | null;
    endAt?: string | null;
    status: string;
    priority: string;
    address: string;
  };
  technicians: string[];
  workReport: {
    isSigned: boolean;
    signedAt?: string | null;
    workPerformed: string;
    materials: string;
    extraWork: string;
  } | null;
};

type WorkReportFormStepProps = {
  report: WorkReport | null;
  values: WorkReportDraftValues;
  workPerformedRef: RefObject<HTMLTextAreaElement | null>;
  workPerformedLength: number;
  onWorkPerformedChange: (value: string) => void;
  showOptionalDetails: boolean;
  onToggleOptionalDetails: () => void;
  onExtraWorkChange: (value: string) => void;
  onMaterialsChange: (value: string) => void;
  allAttachments: AttachmentRecord[];
  attachmentsLoading: boolean;
  attachmentsUploading: boolean;
  openingAttachmentId: string | null;
  onReportAttachmentsUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  onOpenAttachment: (attachment: AttachmentRecord) => Promise<void>;
  formatAttachmentKb: (size?: number) => string;
  attachmentMaxSizeMb: number;
  isRecordingAudio: boolean;
  recordingSeconds: number;
  audioRecorderError: string | null;
  onStartAudioRecording: () => Promise<void>;
  onStopAudioRecording: () => void;
  formatRecordingDuration: (seconds: number) => string;
  showAddressHistory: boolean;
  onToggleAddressHistory: () => void;
  hasAddressHistoryContext: boolean;
  addressHistoryLoading: boolean;
  addressHistoryError: string | null;
  addressHistoryItems: AddressHistoryItem[];
};

export default function WorkReportFormStep({
  report,
  values,
  workPerformedRef,
  workPerformedLength,
  onWorkPerformedChange,
  showOptionalDetails,
  onToggleOptionalDetails,
  onExtraWorkChange,
  onMaterialsChange,
  allAttachments,
  attachmentsLoading,
  attachmentsUploading,
  openingAttachmentId,
  onReportAttachmentsUpload,
  onOpenAttachment,
  formatAttachmentKb,
  attachmentMaxSizeMb,
  isRecordingAudio,
  recordingSeconds,
  audioRecorderError,
  onStartAudioRecording,
  onStopAudioRecording,
  formatRecordingDuration,
  showAddressHistory,
  onToggleAddressHistory,
  hasAddressHistoryContext,
  addressHistoryLoading,
  addressHistoryError,
  addressHistoryItems
}: WorkReportFormStepProps) {
  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-slate-600">
          <Clock className="h-4 w-4" />
          Tempi
        </div>
        <p className="mb-3 text-xs text-slate-500">
          Il tempo viene stimato automaticamente. Se vuoi puoi correggerlo.
        </p>
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div>
            <div className="text-slate-500">Inizio</div>
            <div className="font-semibold text-slate-900">
              {report?.actualStartAt ? new Date(report.actualStartAt).toLocaleTimeString() : '--:--'}
            </div>
          </div>
          <div>
            <div className="text-slate-500">Fine</div>
            <div className="font-semibold text-slate-900">
              {report?.actualEndAt ? new Date(report.actualEndAt).toLocaleTimeString() : '--:--'}
            </div>
          </div>
          <div>
            <div className="text-slate-500">Totale</div>
            <div className="font-semibold text-brand-600">{report?.actualMinutes || 0} min</div>
          </div>
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <label className="text-sm font-semibold text-slate-900">
            Lavori svolti
          </label>
          <span className="text-xs text-slate-500">
            {workPerformedLength} caratteri
          </span>
        </div>
        <textarea
          ref={workPerformedRef}
          value={values.workPerformed}
          onChange={e => onWorkPerformedChange(e.target.value)}
          rows={5}
          className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-brand-400/40"
          placeholder="Descrivi in modo chiaro il lavoro eseguito..."
        />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white">
        <button
          type="button"
          className="flex w-full items-center justify-between px-4 py-3 text-left"
          onClick={onToggleOptionalDetails}
        >
          <span className="text-sm font-semibold text-slate-900">Aggiungi extra/materiali</span>
          {showOptionalDetails ? (
            <ChevronDown className="h-4 w-4 text-slate-500" />
          ) : (
            <ChevronRight className="h-4 w-4 text-slate-500" />
          )}
        </button>
        {showOptionalDetails && (
          <div className="space-y-4 border-t border-slate-200 px-4 py-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Extra / Varianti
              </label>
              <textarea
                value={values.extraWork}
                onChange={e => onExtraWorkChange(e.target.value)}
                rows={3}
                className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-brand-400/40"
                placeholder="Varianti o lavori aggiuntivi..."
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Materiali utilizzati
              </label>
              <textarea
                value={values.materials}
                onChange={e => onMaterialsChange(e.target.value)}
                rows={3}
                className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-brand-400/40"
                placeholder="Materiali e quantità..."
              />
            </div>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold text-slate-900">Allegati</h4>
            <p className="text-xs text-slate-500">Azioni disponibili: Allega file, Registra audio.</p>
          </div>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
            {attachmentsUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
            {attachmentsUploading ? 'Allego...' : 'Allega file'}
            <input
              type="file"
              multiple
              accept="image/*,audio/*,video/*,application/pdf,application/*"
              className="hidden"
              onChange={onReportAttachmentsUpload}
              disabled={attachmentsUploading}
            />
          </label>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Formati consentiti: PNG/JPG/WEBP/GIF, MP4/MOV, PDF, audio (mp3/wav/webm/ogg/mp4). Dimensione massima: {attachmentMaxSizeMb}MB.
        </p>

        {attachmentsLoading && allAttachments.length === 0 && (
          <div className="mt-3 text-xs text-slate-500">Caricamento allegati...</div>
        )}

        {allAttachments.length > 0 ? (
          <div className="mt-3 space-y-2">
            {allAttachments.map((attachment) => (
              <button
                type="button"
                key={attachment.id}
                onClick={() => { void onOpenAttachment(attachment); }}
                className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
              >
                <div className="flex min-w-0 items-center gap-2">
                  {openingAttachmentId === attachment.id ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-slate-500" />
                  ) : (
                    <Paperclip className="h-4 w-4 shrink-0 text-slate-500" />
                  )}
                  <span className="truncate">{attachment.originalName}</span>
                </div>
                <span className="shrink-0 text-xs text-slate-500">{formatAttachmentKb(attachment.size)}</span>
              </button>
            ))}
          </div>
        ) : (
          !attachmentsLoading && (
            <div className="mt-3 rounded-xl border border-dashed border-slate-200 px-3 py-3 text-xs text-slate-500">
              Nessun allegato disponibile.
            </div>
          )
        )}

        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-2">
              <h5 className="text-sm font-semibold text-slate-900">Registra audio</h5>
              <p className="text-xs text-slate-500">Registra un memo vocale nello stesso elenco allegati.</p>
            </div>
            {isRecordingAudio ? (
              <button
                type="button"
                onClick={onStopAudioRecording}
                className="inline-flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100"
              >
                <Square className="h-4 w-4" />
                Ferma
              </button>
            ) : (
              <button
                type="button"
                onClick={() => { void onStartAudioRecording(); }}
                disabled={attachmentsUploading}
                className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
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
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white">
        <button
          type="button"
          className="flex w-full items-center justify-between px-4 py-3 text-left"
          onClick={onToggleAddressHistory}
        >
          <span className="text-sm font-semibold text-slate-900">Storico indirizzo</span>
          {showAddressHistory ? (
            <ChevronDown className="h-4 w-4 text-slate-500" />
          ) : (
            <ChevronRight className="h-4 w-4 text-slate-500" />
          )}
        </button>
        {showAddressHistory && (
          <div className="space-y-2 border-t border-slate-200 px-4 py-4">
            {!hasAddressHistoryContext ? (
              <div className="rounded-xl border border-dashed border-slate-200 px-3 py-3 text-xs text-slate-500">
                Storico non disponibile: cliente o indirizzo non associato all&apos;intervento.
              </div>
            ) : addressHistoryLoading ? (
              <div className="text-xs text-slate-500">Caricamento storico indirizzo...</div>
            ) : addressHistoryError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {addressHistoryError}
              </div>
            ) : addressHistoryItems.length > 0 ? (
              <div className="space-y-2">
                {addressHistoryItems.map((item) => {
                  const dateRef = item.intervention.startAt || item.intervention.endAt || null;
                  return (
                    <div key={item.intervention.id} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs font-semibold text-slate-800">{item.intervention.title}</div>
                        <div className="text-[11px] text-slate-500">
                          {dateRef ? new Date(dateRef).toLocaleDateString('it-IT') : 'Data non pianificata'}
                        </div>
                      </div>
                      {item.workReport?.workPerformed ? (
                        <p className="mt-1 text-xs text-slate-600 line-clamp-2">{item.workReport.workPerformed}</p>
                      ) : (
                        <p className="mt-1 text-xs text-slate-500 italic">Bolla non compilata</p>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200 px-3 py-3 text-xs text-slate-500">
                Nessuno storico disponibile per questo indirizzo.
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

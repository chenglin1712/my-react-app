import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
} from 'firebase/firestore';
import { db } from '../../../../firebase';
import { submitReport } from '../../../src/userServives/reportService';
import '../../../static/css/_game/pronunciation-community.css';

const REPORT_REASONS = {
  inappropriate: '不當內容',
  wrong_content: '內容錯誤',
  spam: '垃圾內容',
  other: '其他',
};

const formatCreatedAt = (timestamp) => {
  const date = timestamp?.toDate?.();

  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return '—';
  }

  return new Intl.DateTimeFormat('zh-TW', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
};

export default function PronunciationCommunity() {
  const { tribe } = useParams();

  const [recordings, setRecordings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const [reportTarget, setReportTarget] = useState(null);
  const [reason, setReason] = useState('inappropriate');
  const [reasonText, setReasonText] = useState('');
  const [submittingReport, setSubmittingReport] = useState(false);

  const loadRecordings = useCallback(async () => {
    if (!tribe) {
      setRecordings([]);
      setError('缺少族語參數，無法載入社群錄音。');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');

    try {
      const recordingsQuery = query(
        collection(db, 'pronunciations', tribe, 'recordings'),
        orderBy('createdAt', 'desc'),
        limit(200),
      );
      const snapshot = await getDocs(recordingsQuery);

      setRecordings(
        snapshot.docs
          .map((document) => ({
            id: document.id,
            ...document.data(),
          }))
          .filter((recording) => recording.word && recording.storageUrl),
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [tribe]);

  useEffect(() => {
    loadRecordings();
  }, [loadRecordings]);

  const groupedRecordings = useMemo(() => {
    const groups = new Map();

    recordings.forEach((recording) => {
      if (!groups.has(recording.word)) {
        groups.set(recording.word, []);
      }

      groups.get(recording.word).push(recording);
    });

    return Array.from(groups, ([word, items]) => ({
      word,
      items,
    }));
  }, [recordings]);

  const openReportModal = (recording) => {
    setReportTarget(recording);
    setReason('inappropriate');
    setReasonText('');
    setError('');
    setSuccessMessage('');
  };

  const closeReportModal = () => {
    if (submittingReport) return;

    setReportTarget(null);
    setReason('inappropriate');
    setReasonText('');
  };

  const submitRecordingReport = async (event) => {
    event.preventDefault();

    if (!reportTarget) return;

    const trimmedReasonText = reasonText.trim();
    if (reason === 'other' && !trimmedReasonText) return;

    setSubmittingReport(true);
    setError('');
    setSuccessMessage('');

    try {
      await submitReport({
        targetType: 'recording',
        targetId: reportTarget.id,
        targetTribe: tribe,
        reason,
        reasonText: reason === 'other' ? trimmedReasonText : '',
      });

      setReportTarget(null);
      setReason('inappropriate');
      setReasonText('');
      setSuccessMessage('已送出檢舉，感謝您協助維護社群品質');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmittingReport(false);
    }
  };

  return (
    <main className="pron-community-page">
      <header className="pron-community-heading">
        <div>
          <p className="pron-community-eyebrow">YUAN・YU COMMUNITY</p>
          <h1>社群示範發音</h1>
          <p>
            聆聽其他學習者分享的真人錄音，從不同聲音認識族語發音。
          </p>
        </div>

        <button
          type="button"
          className="pron-community-refresh"
          disabled={loading}
          onClick={loadRecordings}
        >
          {loading ? '載入中…' : '重新整理'}
        </button>
      </header>

      {successMessage && (
        <div className="pron-community-message success" role="status">
          {successMessage}
        </div>
      )}

      {error && (
        <div className="pron-community-message error" role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <div className="pron-community-loading" role="status">
          <span className="pron-community-spinner" aria-hidden="true" />
          載入社群錄音中…
        </div>
      ) : groupedRecordings.length === 0 ? (
        <div className="pron-community-empty">
          <h2>目前還沒有示範錄音</h2>
          <p>完成發音練習並分享錄音後，就能在這裡聽見。</p>
        </div>
      ) : (
        <div className="pron-community-groups">
          {groupedRecordings.map(({ word, items }) => (
            <section className="pron-community-group" key={word}>
              <div className="pron-community-group-heading">
                <h2>{word}</h2>
                <span>{items.length} 筆錄音</span>
              </div>

              <ul className="pron-community-recordings">
                {items.map((recording) => (
                  <li
                    className="pron-community-recording"
                    key={recording.id}
                  >
                    <audio
                      controls
                      preload="none"
                      src={recording.storageUrl}
                      aria-label={`${word} 的社群示範發音`}
                    >
                      您的瀏覽器不支援音訊播放。
                    </audio>

                    <div className="pron-community-meta">
                      <span className="pron-community-score">
                        {recording.score ?? '—'} 分
                      </span>
                      <time>
                        {formatCreatedAt(recording.createdAt)}
                      </time>
                    </div>

                    <button
                      type="button"
                      className="pron-community-report-button"
                      onClick={() => openReportModal(recording)}
                    >
                      檢舉
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {reportTarget && (
        <div
          className="pron-community-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeReportModal();
            }
          }}
        >
          <section
            className="pron-community-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pron-report-title"
          >
            <div className="pron-community-modal-heading">
              <div>
                <h2 id="pron-report-title">檢舉錄音</h2>
                <p>詞彙：{reportTarget.word}</p>
              </div>

              <button
                type="button"
                aria-label="關閉檢舉視窗"
                disabled={submittingReport}
                onClick={closeReportModal}
              >
                ×
              </button>
            </div>

            <form onSubmit={submitRecordingReport}>
              <fieldset disabled={submittingReport}>
                <legend>請選擇檢舉原因</legend>

                {Object.entries(REPORT_REASONS).map(([value, label]) => (
                  <label
                    className="pron-community-reason-option"
                    key={value}
                  >
                    <input
                      type="radio"
                      name="report-reason"
                      value={value}
                      checked={reason === value}
                      onChange={(event) => setReason(event.target.value)}
                    />
                    <span>{label}</span>
                  </label>
                ))}

                {reason === 'other' && (
                  <label className="pron-community-reason-text">
                    補充說明
                    <textarea
                      aria-label="補充說明"
                      rows={3}
                      maxLength={500}
                      required
                      value={reasonText}
                      onChange={(event) => setReasonText(event.target.value)}
                      placeholder="請簡短說明檢舉原因"
                    />
                  </label>
                )}
              </fieldset>

              <div className="pron-community-modal-actions">
                <button
                  type="button"
                  className="pron-community-cancel-button"
                  disabled={submittingReport}
                  onClick={closeReportModal}
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="pron-community-submit-button"
                  disabled={
                    submittingReport
                    || (reason === 'other' && !reasonText.trim())
                  }
                >
                  {submittingReport ? '送出中…' : '送出檢舉'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}

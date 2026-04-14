'use client';

import { useMemo, useState } from 'react';

function ResultCard({ item }) {
  const badgeBg =
    item.status === 'FAIL' ? '#fee2e2' : item.status === 'WARN' ? '#fef3c7' : '#dcfce7';

  const badgeColor =
    item.status === 'FAIL' ? '#991b1b' : item.status === 'WARN' ? '#92400e' : '#166534';

  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #ddd',
        borderRadius: '16px',
        padding: '16px',
        marginTop: '12px',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: '12px',
          alignItems: 'center',
          marginBottom: '8px',
        }}
      >
        <strong>{item.name}</strong>
        <span
          style={{
            padding: '6px 12px',
            borderRadius: '999px',
            fontSize: '13px',
            fontWeight: '700',
            background: badgeBg,
            color: badgeColor,
          }}
        >
          {item.status}
        </span>
      </div>

      <div style={{ marginBottom: '8px', lineHeight: 1.6 }}>{item.message}</div>
      <div style={{ color: '#666', fontSize: '14px', lineHeight: 1.6 }}>
        개선 방안: {item.help}
      </div>

      {item.evidence ? (
        <pre
          style={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            background: '#111827',
            color: '#f9fafb',
            padding: '12px',
            borderRadius: '12px',
            marginTop: '10px',
            fontSize: '13px',
            overflowX: 'auto',
          }}
        >
          {item.evidence}
        </pre>
      ) : null}
    </div>
  );
}

export default function HomePage() {
  const [url, setUrl] = useState('https://www.playd.com');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [activeTab, setActiveTab] = useState('basic');
  const [hidePass, setHidePass] = useState(false);

  const basicKeys = [
    'title-exists',
    'title-count',
    'title-length',
    'meta-description',
    'h1-count',
    'img-alt',
    'viewport',
    'canonical',
    'og-tags',
    'robots-noindex',
    'http-links',
    'invalid-links',
    'html-size',
  ];

  const visibleChecks = useMemo(() => {
    if (!result?.checks) return [];

    const sorted = [...result.checks].sort((a, b) => {
      const statusOrder = { FAIL: 0, WARN: 1, PASS: 2 };
      return statusOrder[a.status] - statusOrder[b.status];
    });

    const tabFiltered =
      activeTab === 'basic'
        ? sorted.filter((item) => basicKeys.includes(item.key))
        : sorted;

    return hidePass ? tabFiltered.filter((item) => item.status !== 'PASS') : tabFiltered;
  }, [result, activeTab, hidePass]);

  async function onAnalyze() {
    setError('');
    setResult(null);
    setLoading(true);

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || '분석 중 오류가 발생했습니다.');
      }

      setResult(data);
    } catch (err) {
      setError(err.message || '분석 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: '900px', margin: '0 auto', padding: '40px 20px' }}>
      <h1 style={{ fontSize: '32px', marginBottom: '8px' }}>연결 URL SEO 진단도구</h1>
      <p style={{ color: '#666', marginBottom: '24px' }}>
        URL을 입력하면 기본 SEO 항목을 점검하는 사이트입니다.
      </p>

      <div
        style={{
          background: '#fff',
          border: '1px solid #ddd',
          borderRadius: '16px',
          padding: '20px',
        }}
      >
        <div style={{ marginBottom: '12px', fontWeight: '700' }}>분석할 URL</div>

        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com"
            style={{
              flex: 1,
              minWidth: '280px',
              height: '48px',
              padding: '0 14px',
              border: '1px solid #ccc',
              borderRadius: '12px',
              fontSize: '15px',
            }}
          />

          <button
            onClick={onAnalyze}
            disabled={loading}
            style={{
              height: '48px',
              padding: '0 18px',
              border: 'none',
              borderRadius: '12px',
              background: '#111827',
              color: '#fff',
              fontWeight: '700',
              cursor: 'pointer',
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? '분석 중...' : '분석 시작'}
          </button>
        </div>

        {error ? (
          <div style={{ marginTop: '12px', color: '#b91c1c', fontWeight: '700' }}>{error}</div>
        ) : null}
      </div>

      {result ? (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: '12px',
              marginTop: '24px',
            }}
          >
            <div
              style={{
                background: '#fff',
                border: '1px solid #ddd',
                borderRadius: '16px',
                padding: '16px',
              }}
            >
              <div style={{ fontSize: '13px', color: '#666', marginBottom: '8px' }}>최종 등급</div>
              <div style={{ fontSize: '28px', fontWeight: '800' }}>{result.grade}</div>
            </div>

            <div
              style={{
                background: '#fff',
                border: '1px solid #ddd',
                borderRadius: '16px',
                padding: '16px',
              }}
            >
              <div style={{ fontSize: '13px', color: '#666', marginBottom: '8px' }}>총점</div>
              <div style={{ fontSize: '28px', fontWeight: '800' }}>{result.score}</div>
            </div>

            <div
              style={{
                background: '#fff',
                border: '1px solid #ddd',
                borderRadius: '16px',
                padding: '16px',
              }}
            >
              <div style={{ fontSize: '13px', color: '#666', marginBottom: '8px' }}>통과 / 경고 / 실패</div>
              <div style={{ fontSize: '28px', fontWeight: '800' }}>
                {result.summary.pass} / {result.summary.warn} / {result.summary.fail}
              </div>
            </div>
          </div>

          <div style={{ marginTop: '24px' }}>
            <h2 style={{ fontSize: '22px', marginBottom: '12px' }}>진단 결과</h2>

            <div
              style={{
                display: 'flex',
                gap: '10px',
                flexWrap: 'wrap',
                alignItems: 'center',
                marginBottom: '12px',
              }}
            >
              <button
                onClick={() => setActiveTab('basic')}
                style={{
                  height: '40px',
                  padding: '0 16px',
                  borderRadius: '999px',
                  border: activeTab === 'basic' ? '1px solid #111827' : '1px solid #d1d5db',
                  background: activeTab === 'basic' ? '#111827' : '#fff',
                  color: activeTab === 'basic' ? '#fff' : '#111827',
                  fontWeight: '700',
                  cursor: 'pointer',
                }}
              >
                기본
              </button>

              <button
                onClick={() => setActiveTab('advanced')}
                style={{
                  height: '40px',
                  padding: '0 16px',
                  borderRadius: '999px',
                  border: activeTab === 'advanced' ? '1px solid #111827' : '1px solid #d1d5db',
                  background: activeTab === 'advanced' ? '#111827' : '#fff',
                  color: activeTab === 'advanced' ? '#fff' : '#111827',
                  fontWeight: '700',
                  cursor: 'pointer',
                }}
              >
                고급
              </button>

              <button
                onClick={() => setHidePass(!hidePass)}
                style={{
                  height: '36px',
                  padding: '0 14px',
                  borderRadius: '10px',
                  border: '1px solid #d1d5db',
                  background: hidePass ? '#fff7ed' : '#f9fafb',
                  color: hidePass ? '#c2410c' : '#374151',
                  fontWeight: '700',
                  cursor: 'pointer',
                }}
              >
                {hidePass ? 'PASS 다시 보기' : 'PASS 숨기기'}
              </button>
            </div>

            {visibleChecks.length === 0 ? (
              <div
                style={{
                  background: '#fff',
                  border: '1px solid #ddd',
                  borderRadius: '16px',
                  padding: '16px',
                  color: '#666',
                }}
              >
                표시할 항목이 없습니다.
              </div>
            ) : (
              visibleChecks.map((item) => <ResultCard key={item.key} item={item} />)
            )}
          </div>

          <div style={{ marginTop: '14px', color: '#666', fontSize: '14px' }}>
            분석 시각: {new Date(result.analyzedAt).toLocaleString('ko-KR')}
          </div>
        </>
      ) : null}
    </main>
  );
}
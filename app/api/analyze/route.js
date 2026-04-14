import * as cheerio from 'cheerio';
import iconv from 'iconv-lite';

function normalizeUrl(input) {
  let value = (input || '').trim();

  if (!/^https?:\/\//i.test(value)) {
    value = `https://${value}`;
  }

  return value;
}

function clip(text, max = 300) {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function getGrade(score) {
  if (score >= 95) return 'A+';
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

function makeItem({
  key,
  name,
  status,
  message,
  help,
  evidence = '',
  group = 'basic',
  priority = 50,
}) {
  return { key, name, status, message, help, evidence, group, priority };
}

function toAbsoluteUrl(baseUrl, maybeRelative) {
  try {
    return new URL(maybeRelative, baseUrl).toString();
  } catch {
    return '';
  }
}

async function checkUrlExists(url) {
  try {
    let response;

try {
  response = await fetch(url, {
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
    },
    redirect: 'follow',
    cache: 'no-store',
  });
} catch (fetchError) {
  return Response.json(
    {
      error: `분석 실패: ${fetchError?.message || 'fetch failed'}`,
      detail: String(fetchError),
      cause: String(fetchError?.cause || ''),
    },
    { status: 500 }
  );
}
    return res.ok;
  } catch {
    return false;
  }
}

function detectCharsetFromBuffer(buffer, contentTypeHeader = '') {
  const headerMatch = contentTypeHeader.match(/charset=([^;]+)/i);
  if (headerMatch?.[1]) {
    return headerMatch[1].trim().toLowerCase();
  }

  const ascii = buffer.toString('ascii');
  const metaCharsetMatch = ascii.match(/<meta[^>]*charset=["']?\s*([a-zA-Z0-9_-]+)/i);
  if (metaCharsetMatch?.[1]) {
    return metaCharsetMatch[1].trim().toLowerCase();
  }

  const metaHttpEquivMatch = ascii.match(
    /<meta[^>]*http-equiv=["']content-type["'][^>]*content=["'][^"']*charset=([a-zA-Z0-9_-]+)/i
  );
  if (metaHttpEquivMatch?.[1]) {
    return metaHttpEquivMatch[1].trim().toLowerCase();
  }

  return 'utf-8';
}

function decodeHtmlBuffer(buffer, contentTypeHeader = '') {
  let charset = detectCharsetFromBuffer(buffer, contentTypeHeader);

  if (charset === 'euc-kr' || charset === 'ks_c_5601-1987' || charset === 'ksc5601') {
    charset = 'cp949';
  }

  if (charset === 'utf8') {
    charset = 'utf-8';
  }

  if (!iconv.encodingExists(charset)) {
    charset = 'utf-8';
  }

  try {
    return {
      html: iconv.decode(buffer, charset),
      charset,
    };
  } catch {
    return {
      html: iconv.decode(buffer, 'utf-8'),
      charset: 'utf-8',
    };
  }
}

export async function POST(req) {
  try {
    const body = await req.json();
    const url = normalizeUrl(body?.url);

    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return Response.json({ error: '올바른 URL 형식이 아닙니다.' }, { status: 400 });
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SEOAuditBot/1.0)',
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
      cache: 'no-store',
    });

    if (!response.ok) {
      return Response.json(
        { error: `페이지 요청에 실패했습니다. status=${response.status}` },
        { status: 400 }
      );
    }

    const finalUrl = response.url || url;
    const finalParsed = new URL(finalUrl);

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const contentTypeHeader = response.headers.get('content-type') || '';
    const { html, charset } = decodeHtmlBuffer(buffer, contentTypeHeader);

    const contentLength = Number(response.headers.get('content-length') || 0);
    const htmlSizeMB = contentLength
      ? contentLength / 1024 / 1024
      : Buffer.byteLength(html, 'utf8') / 1024 / 1024;

    const $ = cheerio.load(html);
    const checks = [];

    const titleTags = $('title');
    const titles = titleTags
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean);

    const titleCount = titles.length;
    const mainTitle = titles[0] || '';

    if (titleCount === 0) {
      checks.push(
        makeItem({
          key: 'title-exists',
          name: '<title> 존재 여부',
          status: 'FAIL',
          message: '<title> 태그를 찾을 수 없습니다.',
          help: '페이지마다 대표 title 태그를 1개 설정하세요.',
          group: 'basic',
          priority: 1,
        })
      );
    } else if (titleCount > 1) {
      checks.push(
        makeItem({
          key: 'title-count',
          name: '<title> 개수',
          status: 'WARN',
          message: `<title> 태그가 ${titleCount}개 발견되었습니다.`,
          help: '페이지당 title은 1개만 유지하는 것이 좋습니다.',
          evidence: titles.map((t) => `<title>${t}</title>`).join('\n'),
          group: 'basic',
          priority: 2,
        })
      );
    } else {
      checks.push(
        makeItem({
          key: 'title-count',
          name: '<title> 개수',
          status: 'PASS',
          message: '<title> 태그가 1개입니다.',
          help: '현재 상태를 유지하세요.',
          evidence: `<title>${mainTitle}</title>`,
          group: 'basic',
          priority: 2,
        })
      );
    }

    checks.push(
      makeItem({
        key: 'title-length',
        name: 'title 길이',
        status: mainTitle.length >= 15 && mainTitle.length <= 45 ? 'PASS' : titleCount === 0 ? 'FAIL' : 'WARN',
        message:
          mainTitle.length >= 15 && mainTitle.length <= 45
            ? `title 길이가 적절합니다. (${mainTitle.length}자)`
            : `title 길이가 권장 범위(15~45자)를 벗어났습니다. 현재 ${mainTitle.length}자입니다.`,
        help: '브랜드명과 핵심 키워드를 포함해 15~45자로 조정하세요.',
        evidence: mainTitle,
        group: 'basic',
        priority: 3,
      })
    );

    const metaDescription = $('meta[name="description"]').attr('content')?.trim() || '';
    checks.push(
      makeItem({
        key: 'meta-description',
        name: 'meta description',
        status: metaDescription ? 'PASS' : 'WARN',
        message: metaDescription
          ? 'meta description이 존재합니다.'
          : 'meta description이 없습니다.',
        help: '페이지 설명을 담은 meta description을 추가하거나, 기존 설명문이 페이지 주제와 맞는지 점검하세요.',
        evidence: clip(metaDescription),
        group: 'basic',
        priority: 4,
      })
    );

    const h1Count = $('h1').length;
    checks.push(
      makeItem({
        key: 'h1-count',
        name: 'H1 개수',
        status: h1Count === 1 ? 'PASS' : 'WARN',
        message:
          h1Count === 1
            ? 'H1 태그가 1개입니다.'
            : h1Count === 0
            ? 'H1 태그가 없습니다.'
            : `H1 태그가 ${h1Count}개입니다.`,
        help: '페이지 대표 H1은 1개로 유지하는 것이 좋습니다.',
        evidence: clip($('h1').first().text().trim()),
        group: 'basic',
        priority: 5,
      })
    );

    const images = $('img');
    const altMissing = [];
    images.each((_, el) => {
      const alt = $(el).attr('alt');
      if (alt === undefined || alt === null || String(alt).trim() === '') {
        altMissing.push($(el).attr('src') || '[src 없음]');
      }
    });

    checks.push(
      makeItem({
        key: 'img-alt',
        name: '이미지 alt 속성',
        status: altMissing.length === 0 ? 'PASS' : altMissing.length > 20 ? 'FAIL' : 'WARN',
        message:
          altMissing.length === 0
            ? '모든 이미지에 alt 속성이 존재합니다.'
            : `alt 속성이 없는 이미지가 ${altMissing.length}개 발견되었습니다.`,
        help: '상품명, 배너 목적 등 의미 있는 alt 텍스트를 추가하세요.',
        evidence: altMissing.slice(0, 20).join('\n'),
        group: 'basic',
        priority: 6,
      })
    );

    const viewport = $('meta[name="viewport"]').attr('content')?.trim() || '';
    checks.push(
      makeItem({
        key: 'viewport',
        name: 'viewport 설정',
        status: viewport ? 'PASS' : 'WARN',
        message: viewport
          ? 'viewport 메타 태그가 존재합니다.'
          : 'viewport 메타 태그가 없습니다.',
        help: '모바일 최적화를 위해 viewport를 추가하세요.',
        evidence: viewport,
        group: 'basic',
        priority: 7,
      })
    );

    const canonical = $('link[rel="canonical"]').attr('href')?.trim() || '';
    checks.push(
      makeItem({
        key: 'canonical',
        name: 'canonical 설정',
        status: canonical ? 'PASS' : 'WARN',
        message: canonical
          ? 'canonical 링크가 존재합니다.'
          : 'canonical 링크가 없습니다.',
        help: '대표 URL을 지정하는 canonical 태그를 고려하세요.',
        evidence: canonical,
        group: 'basic',
        priority: 8,
      })
    );

    const ogTitle = $('meta[property="og:title"]').attr('content')?.trim() || '';
    const ogDescription = $('meta[property="og:description"]').attr('content')?.trim() || '';
    const ogImage = $('meta[property="og:image"]').attr('content')?.trim() || '';

    checks.push(
      makeItem({
        key: 'og-tags',
        name: 'Open Graph 태그',
        status: ogTitle || ogDescription || ogImage ? 'PASS' : 'WARN',
        message:
          ogTitle || ogDescription || ogImage
            ? 'Open Graph 태그가 일부 또는 전체 존재합니다.'
            : 'Open Graph 태그가 없습니다.',
        help: 'og:title, og:description, og:image 등을 추가하세요.',
        evidence: `og:title=${ogTitle || '-'}\nog:description=${ogDescription || '-'}\nog:image=${ogImage || '-'}`,
        group: 'basic',
        priority: 9,
      })
    );

    const robotsMeta = $('meta[name="robots"]').attr('content')?.toLowerCase() || '';

    checks.push(
      makeItem({
        key: 'robots-noindex',
        name: 'robots noindex',
        status: robotsMeta.includes('noindex') ? 'FAIL' : 'PASS',
        message: robotsMeta.includes('noindex')
          ? 'robots 메타에 noindex가 포함되어 있습니다.'
          : 'robots 메타에 noindex가 없습니다.',
        help: '검색 노출이 필요한 페이지라면 noindex 제거를 검토하세요.',
        evidence: robotsMeta || 'robots meta 없음',
        group: 'basic',
        priority: 10,
      })
    );

    checks.push(
      makeItem({
        key: 'robots-meta-exists',
        name: 'meta robots 존재 여부',
        status: robotsMeta ? 'PASS' : 'WARN',
        message: robotsMeta
          ? 'meta robots 태그가 존재합니다.'
          : 'meta robots 태그가 없습니다.',
        help: '검색 정책이 필요한 경우 meta robots를 명시하세요.',
        evidence: robotsMeta,
        group: 'advanced',
        priority: 30,
      })
    );

    const protocolMismatchLinks = [];
    $('a[href]').each((_, el) => {
      const href = ($(el).attr('href') || '').trim();
      if (!href) return;
      if (finalParsed.protocol === 'https:' && href.startsWith('http://')) {
        protocolMismatchLinks.push(href);
      }
    });

    checks.push(
      makeItem({
        key: 'http-links',
        name: 'http 내부 링크 여부',
        status: protocolMismatchLinks.length === 0 ? 'PASS' : 'WARN',
        message:
          protocolMismatchLinks.length === 0
            ? 'https 페이지 내에서 http 링크가 발견되지 않았습니다.'
            : `http 링크가 ${protocolMismatchLinks.length}개 발견되었습니다.`,
        help: '가능하면 모든 내부 링크를 https로 통일하세요.',
        evidence: protocolMismatchLinks.slice(0, 20).join('\n'),
        group: 'basic',
        priority: 11,
      })
    );

    const invalidActionLinks = [];
    $('a[href]').each((_, el) => {
      const href = ($(el).attr('href') || '').trim();
      if (!href) return;
      const lowerHref = href.toLowerCase();
      if (lowerHref === '#' || lowerHref === '#none' || lowerHref.startsWith('javascript:')) {
        invalidActionLinks.push(href);
      }
    });

    checks.push(
      makeItem({
        key: 'invalid-links',
        name: '제한 링크 사용 여부',
        status: invalidActionLinks.length === 0 ? 'PASS' : 'WARN',
        message:
          invalidActionLinks.length === 0
            ? '# 또는 javascript 링크가 발견되지 않았습니다.'
            : `실제 이동이 어려운 링크가 ${invalidActionLinks.length}개 발견되었습니다.`,
        help: '실제 URL로 교체하거나 버튼 요소 사용을 검토하세요.',
        evidence: invalidActionLinks.slice(0, 20).join('\n'),
        group: 'basic',
        priority: 12,
      })
    );

    checks.push(
      makeItem({
        key: 'html-size',
        name: '페이지 크기',
        status: htmlSizeMB <= 1 ? 'PASS' : 'WARN',
        message:
          htmlSizeMB <= 1
            ? `페이지 크기가 양호합니다. (${htmlSizeMB.toFixed(2)} MB)`
            : `페이지 크기가 다소 큽니다. (${htmlSizeMB.toFixed(2)} MB)`,
        help: '불필요한 코드와 리소스 로드를 줄이세요.',
        group: 'advanced',
        priority: 31,
      })
    );

    const htmlLang = $('html').attr('lang')?.trim() || '';
    checks.push(
      makeItem({
        key: 'html-lang',
        name: 'html lang 속성',
        status: htmlLang ? 'PASS' : 'WARN',
        message: htmlLang
          ? 'html 태그에 lang 속성이 존재합니다.'
          : 'html 태그에 lang 속성이 없습니다.',
        help: '예: <html lang="ko"> 형태로 언어를 명시하세요.',
        evidence: htmlLang,
        group: 'advanced',
        priority: 32,
      })
    );

    const faviconHref =
      $('link[rel="icon"]').attr('href')?.trim() ||
      $('link[rel="shortcut icon"]').attr('href')?.trim() ||
      '';

    checks.push(
      makeItem({
        key: 'favicon',
        name: 'favicon 존재 여부',
        status: faviconHref ? 'PASS' : 'WARN',
        message: faviconHref
          ? 'favicon 링크가 존재합니다.'
          : 'favicon 링크가 없습니다.',
        help: '브라우저 탭 식별을 위해 favicon을 설정하세요.',
        evidence: faviconHref,
        group: 'advanced',
        priority: 33,
      })
    );

    const jsonLdCount = $('script[type="application/ld+json"]').length;
    const microdataCount = $('[itemscope]').length;
    const schemaTotal = jsonLdCount + microdataCount;

    checks.push(
      makeItem({
        key: 'schema',
        name: '구조화 데이터(schema.org)',
        status: schemaTotal > 0 ? 'PASS' : 'WARN',
        message:
          schemaTotal > 0
            ? `구조화 데이터가 ${schemaTotal}개 감지되었습니다.`
            : '구조화 데이터가 감지되지 않았습니다.',
        help: '상품, 사이트 정보 등에 schema.org 마크업을 고려하세요.',
        evidence: `JSON-LD: ${jsonLdCount}, Microdata: ${microdataCount}`,
        group: 'advanced',
        priority: 34,
      })
    );

    const robotsUrl = toAbsoluteUrl(finalUrl, '/robots.txt');
    const robotsExists = robotsUrl ? await checkUrlExists(robotsUrl) : false;

    checks.push(
      makeItem({
        key: 'robots-txt',
        name: 'robots.txt 존재 여부',
        status: robotsExists ? 'PASS' : 'WARN',
        message: robotsExists
          ? 'robots.txt 파일이 존재합니다.'
          : 'robots.txt 파일이 확인되지 않았습니다.',
        help: '크롤링 정책 관리가 필요하면 robots.txt를 추가하세요.',
        evidence: robotsUrl,
        group: 'advanced',
        priority: 35,
      })
    );

    const sitemapUrl = toAbsoluteUrl(finalUrl, '/sitemap.xml');
    const sitemapExists = sitemapUrl ? await checkUrlExists(sitemapUrl) : false;

    checks.push(
      makeItem({
        key: 'sitemap-xml',
        name: 'sitemap.xml 존재 여부',
        status: sitemapExists ? 'PASS' : 'WARN',
        message: sitemapExists
          ? 'sitemap.xml 파일이 존재합니다.'
          : 'sitemap.xml 파일이 확인되지 않았습니다.',
        help: '검색엔진 제출용 사이트맵 생성을 고려하세요.',
        evidence: sitemapUrl,
        group: 'advanced',
        priority: 36,
      })
    );

    const imageCount = $('img').length;
    checks.push(
      makeItem({
        key: 'image-count',
        name: '이미지 개수',
        status: imageCount > 0 ? 'PASS' : 'WARN',
        message: imageCount > 0 ? `이미지가 ${imageCount}개 존재합니다.` : '이미지가 없습니다.',
        help: '상품/콘텐츠 성격에 맞게 이미지 사용 여부를 점검하세요.',
        evidence: String(imageCount),
        group: 'advanced',
        priority: 37,
      })
    );

    const internalLinks = [];
    const externalLinks = [];

    $('a[href]').each((_, el) => {
      const href = ($(el).attr('href') || '').trim();
      if (!href) return;
      if (
        href.startsWith('#') ||
        href.toLowerCase().startsWith('javascript:') ||
        href.toLowerCase().startsWith('mailto:') ||
        href.toLowerCase().startsWith('tel:')
      ) {
        return;
      }

      const abs = toAbsoluteUrl(finalUrl, href);
      if (!abs) return;

      try {
        const linkUrl = new URL(abs);
        if (linkUrl.host === finalParsed.host) {
          internalLinks.push(abs);
        } else {
          externalLinks.push(abs);
        }
      } catch {}
    });

    checks.push(
      makeItem({
        key: 'internal-link-count',
        name: '내부 링크 개수',
        status: internalLinks.length > 0 ? 'PASS' : 'WARN',
        message:
          internalLinks.length > 0
            ? `내부 링크가 ${internalLinks.length}개 확인되었습니다.`
            : '내부 링크가 거의 없거나 확인되지 않았습니다.',
        help: '사이트 내 탐색 흐름을 위해 내부 링크 구조를 점검하세요.',
        evidence: String(internalLinks.length),
        group: 'advanced',
        priority: 38,
      })
    );

    checks.push(
      makeItem({
        key: 'external-link-count',
        name: '외부 링크 개수',
        status: 'PASS',
        message: `외부 링크가 ${externalLinks.length}개 확인되었습니다.`,
        help: '외부 링크가 많다면 필요성과 신뢰성을 점검하세요.',
        evidence: String(externalLinks.length),
        group: 'advanced',
        priority: 39,
      })
    );

    checks.push(
      makeItem({
        key: 'detected-charset',
        name: '인코딩 감지 결과',
        status: 'PASS',
        message: `페이지 인코딩을 ${charset} 로 읽었습니다.`,
        help: '글자가 깨질 경우 이 값을 확인하세요.',
        evidence: charset,
        group: 'advanced',
        priority: 40,
      })
    );

    let score = 100;
    for (const item of checks) {
      if (item.status === 'WARN') score -= 4;
      if (item.status === 'FAIL') score -= 12;
    }
    score = Math.max(0, score);

    const summary = {
      pass: checks.filter((x) => x.status === 'PASS').length,
      warn: checks.filter((x) => x.status === 'WARN').length,
      fail: checks.filter((x) => x.status === 'FAIL').length,
    };

    return Response.json({
      url: finalUrl,
      analyzedAt: new Date().toISOString(),
      score,
      grade: getGrade(score),
      summary,
      checks,
    });
  } catch (error) {
  console.error('분석 오류:', error);

  return Response.json(
    {
      error: `분석 실패: ${error?.message || '알 수 없는 오류'}`,
      detail: String(error),
    },
    { status: 500 }
  );
}
}
import * as cheerio from 'cheerio';

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

function makeItem({ key, name, status, message, help, evidence = '' }) {
  return { key, name, status, message, help, evidence };
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
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
      },
      redirect: 'follow',
      cache: 'no-store',
    });
    return res.ok;
  } catch {
    return false;
  }
}

function makeBlockedResult(url, status) {
  return {
    url,
    analyzedAt: new Date().toISOString(),
    score: 0,
    grade: '차단',
    summary: {
      pass: 0,
      warn: 1,
      fail: 1,
    },
    checks: [
      makeItem({
        key: 'site-blocked',
        name: '사이트 자동 분석 제한',
        status: 'FAIL',
        message: `상대 사이트가 자동 요청을 차단하여 분석을 완료하지 못했습니다. status=${status}`,
        help: '일부 쇼핑몰/보안 적용 사이트는 서버 요청을 제한할 수 있습니다. 이 경우 일반 fetch 방식만으로는 분석이 어려울 수 있습니다.',
        evidence: `HTTP status=${status}`,
      }),
      makeItem({
        key: 'site-blocked-help',
        name: '안내',
        status: 'WARN',
        message: '이 사이트는 현재 보안 정책으로 인해 자동 진단이 제한됩니다.',
        help: '필요 시 Playwright 같은 브라우저 기반 분석 방식으로 확장하거나, 해당 사이트는 분석 제외 대상으로 안내하는 방식을 권장합니다.',
        evidence: '자동 요청 차단 가능성',
      }),
    ],
  };
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

    let response;

    try {
      response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
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

    if (!response.ok) {
      if ([401, 403, 417, 429].includes(response.status)) {
        return Response.json(makeBlockedResult(url, response.status));
      }

      return Response.json(
        { error: `페이지 요청에 실패했습니다. status=${response.status}` },
        { status: 400 }
      );
    }

    const finalUrl = response.url || url;
    const finalParsed = new URL(finalUrl);

    const html = await response.text();
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
        })
      );
    }

    if (mainTitle.length >= 15 && mainTitle.length <= 45) {
      checks.push(
        makeItem({
          key: 'title-length',
          name: 'title 길이',
          status: 'PASS',
          message: `title 길이가 적절합니다. (${mainTitle.length}자)`,
          help: '현재 수준을 유지하세요.',
          evidence: mainTitle,
        })
      );
    } else {
      checks.push(
        makeItem({
          key: 'title-length',
          name: 'title 길이',
          status: titleCount === 0 ? 'FAIL' : 'WARN',
          message: `title 길이가 권장 범위(15~45자)를 벗어났습니다. 현재 ${mainTitle.length}자입니다.`,
          help: '브랜드명과 핵심 키워드를 포함해 15~45자로 조정하세요.',
          evidence: mainTitle,
        })
      );
    }

    const metaDescription = $('meta[name="description"]').attr('content')?.trim() || '';
    if (metaDescription) {
      checks.push(
        makeItem({
          key: 'meta-description',
          name: 'meta description',
          status: 'PASS',
          message: 'meta description이 존재합니다.',
          help: '설명문이 페이지 주제와 맞는지 주기적으로 점검하세요.',
          evidence: clip(metaDescription),
        })
      );
    } else {
      checks.push(
        makeItem({
          key: 'meta-description',
          name: 'meta description',
          status: 'WARN',
          message: 'meta description이 없습니다.',
          help: '페이지 설명을 담은 meta description을 추가하세요.',
        })
      );
    }

    const h1Count = $('h1').length;
    if (h1Count === 1) {
      checks.push(
        makeItem({
          key: 'h1-count',
          name: 'H1 개수',
          status: 'PASS',
          message: 'H1 태그가 1개입니다.',
          help: '현재 상태를 유지하세요.',
          evidence: clip($('h1').first().text().trim()),
        })
      );
    } else if (h1Count === 0) {
      checks.push(
        makeItem({
          key: 'h1-count',
          name: 'H1 개수',
          status: 'WARN',
          message: 'H1 태그가 없습니다.',
          help: '페이지 주제를 대표하는 H1을 1개 추가하세요.',
        })
      );
    } else {
      checks.push(
        makeItem({
          key: 'h1-count',
          name: 'H1 개수',
          status: 'WARN',
          message: `H1 태그가 ${h1Count}개입니다.`,
          help: '페이지 대표 H1은 1개만 유지하는 것이 좋습니다.',
        })
      );
    }

    const images = $('img');
    const altMissing = [];
    images.each((_, el) => {
      const alt = $(el).attr('alt');
      if (alt === undefined || alt === null || String(alt).trim() === '') {
        altMissing.push($(el).attr('src') || '[src 없음]');
      }
    });

    if (altMissing.length === 0) {
      checks.push(
        makeItem({
          key: 'img-alt',
          name: '이미지 alt 속성',
          status: 'PASS',
          message: '모든 이미지에 alt 속성이 존재합니다.',
          help: '현재 상태를 유지하세요.',
        })
      );
    } else {
      checks.push(
        makeItem({
          key: 'img-alt',
          name: '이미지 alt 속성',
          status: altMissing.length > 20 ? 'FAIL' : 'WARN',
          message: `alt 속성이 없는 이미지가 ${altMissing.length}개 발견되었습니다.`,
          help: '상품명, 배너 목적 등 의미 있는 alt 텍스트를 추가하세요.',
          evidence: altMissing.slice(0, 20).join('\n'),
        })
      );
    }

    const viewport = $('meta[name="viewport"]').attr('content')?.trim() || '';
    if (viewport) {
      checks.push(
        makeItem({
          key: 'viewport',
          name: 'viewport 설정',
          status: 'PASS',
          message: 'viewport 메타 태그가 존재합니다.',
          help: '현재 상태를 유지하세요.',
          evidence: viewport,
        })
      );
    } else {
      checks.push(
        makeItem({
          key: 'viewport',
          name: 'viewport 설정',
          status: 'WARN',
          message: 'viewport 메타 태그가 없습니다.',
          help: '모바일 최적화를 위해 viewport를 추가하세요.',
        })
      );
    }

    const canonical = $('link[rel="canonical"]').attr('href')?.trim() || '';
    if (canonical) {
      checks.push(
        makeItem({
          key: 'canonical',
          name: 'canonical 설정',
          status: 'PASS',
          message: 'canonical 링크가 존재합니다.',
          help: '중복 URL 관리 측면에서 유지하는 것이 좋습니다.',
          evidence: canonical,
        })
      );
    } else {
      checks.push(
        makeItem({
          key: 'canonical',
          name: 'canonical 설정',
          status: 'WARN',
          message: 'canonical 링크가 없습니다.',
          help: '대표 URL을 지정하는 canonical 태그를 고려하세요.',
        })
      );
    }

    const ogTitle = $('meta[property="og:title"]').attr('content')?.trim() || '';
    const ogDescription = $('meta[property="og:description"]').attr('content')?.trim() || '';
    const ogImage = $('meta[property="og:image"]').attr('content')?.trim() || '';

    if (ogTitle || ogDescription || ogImage) {
      checks.push(
        makeItem({
          key: 'og-tags',
          name: 'Open Graph 태그',
          status: 'PASS',
          message: 'Open Graph 태그가 일부 또는 전체 존재합니다.',
          help: 'SNS 공유 품질 유지를 위해 현재 상태를 점검하세요.',
          evidence: `og:title=${ogTitle || '-'}\nog:description=${ogDescription || '-'}\nog:image=${ogImage || '-'}`,
        })
      );
    } else {
      checks.push(
        makeItem({
          key: 'og-tags',
          name: 'Open Graph 태그',
          status: 'WARN',
          message: 'Open Graph 태그가 없습니다.',
          help: '공유 미리보기를 위해 og:title, og:description, og:image 등을 추가하세요.',
        })
      );
    }

    const robotsMeta = $('meta[name="robots"]').attr('content')?.toLowerCase() || '';
    if (robotsMeta.includes('noindex')) {
      checks.push(
        makeItem({
          key: 'robots-noindex',
          name: 'robots noindex',
          status: 'FAIL',
          message: 'robots 메타에 noindex가 포함되어 있습니다.',
          help: '검색 노출이 필요한 페이지라면 noindex 제거를 검토하세요.',
          evidence: robotsMeta,
        })
      );
    } else {
      checks.push(
        makeItem({
          key: 'robots-noindex',
          name: 'robots noindex',
          status: 'PASS',
          message: 'robots 메타에 noindex가 없습니다.',
          help: '현재 상태를 유지하세요.',
          evidence: robotsMeta || 'robots meta 없음',
        })
      );
    }

    if (robotsMeta) {
      checks.push(
        makeItem({
          key: 'robots-meta-exists',
          name: 'meta robots 존재 여부',
          status: 'PASS',
          message: 'meta robots 태그가 존재합니다.',
          help: '검색 정책이 의도한 값인지 확인하세요.',
          evidence: robotsMeta,
        })
      );
    } else {
      checks.push(
        makeItem({
          key: 'robots-meta-exists',
          name: 'meta robots 존재 여부',
          status: 'WARN',
          message: 'meta robots 태그가 없습니다.',
          help: '검색 정책이 필요한 경우 meta robots를 명시하세요.',
        })
      );
    }

    const protocolMismatchLinks = [];
    $('a[href]').each((_, el) => {
      const href = ($(el).attr('href') || '').trim();
      if (!href) return;
      if (finalParsed.protocol === 'https:' && href.startsWith('http://')) {
        protocolMismatchLinks.push(href);
      }
    });

    if (protocolMismatchLinks.length === 0) {
      checks.push(
        makeItem({
          key: 'http-links',
          name: 'http 내부 링크 여부',
          status: 'PASS',
          message: 'https 페이지 내에서 http 링크가 발견되지 않았습니다.',
          help: '현재 상태를 유지하세요.',
        })
      );
    } else {
      checks.push(
        makeItem({
          key: 'http-links',
          name: 'http 내부 링크 여부',
          status: 'WARN',
          message: `http 링크가 ${protocolMismatchLinks.length}개 발견되었습니다.`,
          help: '가능하면 모든 내부 링크를 https로 통일하세요.',
          evidence: protocolMismatchLinks.slice(0, 20).join('\n'),
        })
      );
    }

    const invalidActionLinks = [];
    $('a[href]').each((_, el) => {
      const href = ($(el).attr('href') || '').trim();
      if (!href) return;
      const lowerHref = href.toLowerCase();
      if (
        lowerHref === '#' ||
        lowerHref === '#none' ||
        lowerHref.startsWith('javascript:')
      ) {
        invalidActionLinks.push(href);
      }
    });

    if (invalidActionLinks.length === 0) {
      checks.push(
        makeItem({
          key: 'invalid-links',
          name: '제한 링크 사용 여부',
          status: 'PASS',
          message: '# 또는 javascript 링크가 발견되지 않았습니다.',
          help: '현재 상태를 유지하세요.',
        })
      );
    } else {
      checks.push(
        makeItem({
          key: 'invalid-links',
          name: '제한 링크 사용 여부',
          status: 'WARN',
          message: `실제 이동이 어려운 링크가 ${invalidActionLinks.length}개 발견되었습니다.`,
          help: '실제 URL로 교체하거나 버튼 요소 사용을 검토하세요.',
          evidence: invalidActionLinks.slice(0, 20).join('\n'),
        })
      );
    }

    if (htmlSizeMB <= 1) {
      checks.push(
        makeItem({
          key: 'html-size',
          name: '페이지 크기',
          status: 'PASS',
          message: `페이지 크기가 양호합니다. (${htmlSizeMB.toFixed(2)} MB)`,
          help: '현재 상태를 유지하세요.',
        })
      );
    } else {
      checks.push(
        makeItem({
          key: 'html-size',
          name: '페이지 크기',
          status: 'WARN',
          message: `페이지 크기가 다소 큽니다. (${htmlSizeMB.toFixed(2)} MB)`,
          help: '불필요한 코드와 리소스 로드를 줄이세요.',
        })
      );
    }

    const htmlLang = $('html').attr('lang')?.trim() || '';
    if (htmlLang) {
      checks.push(
        makeItem({
          key: 'html-lang',
          name: 'html lang 속성',
          status: 'PASS',
          message: 'html 태그에 lang 속성이 존재합니다.',
          help: '현재 상태를 유지하세요.',
          evidence: htmlLang,
        })
      );
    } else {
      checks.push(
        makeItem({
          key: 'html-lang',
          name: 'html lang 속성',
          status: 'WARN',
          message: 'html 태그에 lang 속성이 없습니다.',
          help: '예: <html lang="ko"> 형태로 언어를 명시하세요.',
        })
      );
    }

    const faviconHref =
      $('link[rel="icon"]').attr('href')?.trim() ||
      $('link[rel="shortcut icon"]').attr('href')?.trim() ||
      '';

    if (faviconHref) {
      checks.push(
        makeItem({
          key: 'favicon',
          name: 'favicon 존재 여부',
          status: 'PASS',
          message: 'favicon 링크가 존재합니다.',
          help: '현재 상태를 유지하세요.',
          evidence: faviconHref,
        })
      );
    } else {
      checks.push(
        makeItem({
          key: 'favicon',
          name: 'favicon 존재 여부',
          status: 'WARN',
          message: 'favicon 링크가 없습니다.',
          help: '브라우저 탭 식별을 위해 favicon을 설정하세요.',
        })
      );
    }

    const jsonLdCount = $('script[type="application/ld+json"]').length;
    const microdataCount = $('[itemscope]').length;
    const schemaTotal = jsonLdCount + microdataCount;

    if (schemaTotal > 0) {
      checks.push(
        makeItem({
          key: 'schema',
          name: '구조화 데이터(schema.org)',
          status: 'PASS',
          message: `구조화 데이터가 ${schemaTotal}개 감지되었습니다.`,
          help: '현재 상태를 유지하세요.',
          evidence: `JSON-LD: ${jsonLdCount}, Microdata: ${microdataCount}`,
        })
      );
    } else {
      checks.push(
        makeItem({
          key: 'schema',
          name: '구조화 데이터(schema.org)',
          status: 'WARN',
          message: '구조화 데이터가 감지되지 않았습니다.',
          help: '상품, 사이트 정보 등에 schema.org 마크업을 고려하세요.',
        })
      );
    }

    const robotsUrl = toAbsoluteUrl(finalUrl, '/robots.txt');
    const robotsExists = robotsUrl ? await checkUrlExists(robotsUrl) : false;

    if (robotsExists) {
      checks.push(
        makeItem({
          key: 'robots-txt',
          name: 'robots.txt 존재 여부',
          status: 'PASS',
          message: 'robots.txt 파일이 존재합니다.',
          help: '차단 규칙이 의도한 설정인지 점검하세요.',
          evidence: robotsUrl,
        })
      );
    } else {
      checks.push(
        makeItem({
          key: 'robots-txt',
          name: 'robots.txt 존재 여부',
          status: 'WARN',
          message: 'robots.txt 파일이 확인되지 않았습니다.',
          help: '크롤링 정책 관리가 필요하면 robots.txt를 추가하세요.',
          evidence: robotsUrl,
        })
      );
    }

    const sitemapUrl = toAbsoluteUrl(finalUrl, '/sitemap.xml');
    const sitemapExists = sitemapUrl ? await checkUrlExists(sitemapUrl) : false;

    if (sitemapExists) {
      checks.push(
        makeItem({
          key: 'sitemap-xml',
          name: 'sitemap.xml 존재 여부',
          status: 'PASS',
          message: 'sitemap.xml 파일이 존재합니다.',
          help: '현재 상태를 유지하세요.',
          evidence: sitemapUrl,
        })
      );
    } else {
      checks.push(
        makeItem({
          key: 'sitemap-xml',
          name: 'sitemap.xml 존재 여부',
          status: 'WARN',
          message: 'sitemap.xml 파일이 확인되지 않았습니다.',
          help: '검색엔진 제출용 사이트맵 생성을 고려하세요.',
          evidence: sitemapUrl,
        })
      );
    }

    const imageCount = $('img').length;
    checks.push(
      makeItem({
        key: 'image-count',
        name: '이미지 개수',
        status: imageCount > 0 ? 'PASS' : 'WARN',
        message: imageCount > 0 ? `이미지가 ${imageCount}개 존재합니다.` : '이미지가 없습니다.',
        help: '상품/콘텐츠 성격에 맞게 이미지 사용 여부를 점검하세요.',
        evidence: String(imageCount),
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
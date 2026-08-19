# 소스 어댑터 붙이기

공개 저장소는 로컬 파일과 공식 메타데이터만 포함합니다.  
당신만의 카탈로그 소스는 `plugins/<이름>/`에 두고, 그 디렉터리는 gitignore입니다.

## 최소 계약

서버는 crawl 롤에서 아래 조각을 **주입**받습니다. 없으면 해당 라우트는 등록되지 않고, 서버는 그대로 뜹니다.

```js
// plugins/example/index.js
export default {
  name: 'example',
  parsePlayable(externalId) {
    const match = /^([a-z_]+)\/(\d+)(?:\/(\d+))?$/.exec(externalId);
    if (!match) return null;
    return { category: match[1], id: Number(match[2]), epIdx: match[3] ? Number(match[3]) : 0 };
  },
  createRuntime(ctx) {
    return {
      // adapter, episodeApi, client, parsers…
    };
  },
};
```

`server/src/adapters/local-adapter.ts`가 로컬 파일용 레퍼런스 구현입니다.

## 규칙

- 쿠키 저장/재전송 금지
- 작품·유닛·자산을 몰래 만들지 말 것 (메타데이터만)
- `npm install`이 네이티브 우회 도구를 빌드하게 만들지 말 것

# API Response Contract

Khi project có **internal API trả envelope nhất quán** dạng `{ success, data?, message? }`, AI phải tuân thủ contract sau ở FE/client code — KHÔNG được đọc envelope thủ công, KHÔNG được giả định response là payload thuần.

## Envelope shape

```ts
type ApiEnvelope<T> = {
  success: boolean
  data?: T
  message?: string
}
```

- `success === true` → payload nằm trong `.data`
- `success === false` → lỗi business logic, message trong `.message`
- HTTP status code có thể vẫn là 200 ngay cả khi `success: false`

## Detect contract

Tự động áp dụng rule khi gặp **một trong các tín hiệu**:
- Sample response trong codebase có shape `{success, data, message}`
- File như `api-client.ts` / `services/axios.ts` đã có wrapper unwrap
- README / docs khai báo envelope contract
- Backend code (NestJS interceptor, FastAPI middleware, Laravel resource) wrap mọi response

Nếu KHÔNG có tín hiệu → bỏ qua rule này, dùng pattern thông thường.

## Rules

### 1. KHÔNG đọc envelope thủ công

```ts
// ❌ SAI — response.data là envelope, không phải User[]
const res = await axios.get('/users')
const users = res.data  // dùng nhầm envelope làm payload

// ❌ SAI — pattern defensive `?? response.data` che giấu inconsistency
const users = res.data.data ?? res.data

// ❌ SAI — chain `.data.data` thủ công ở mọi caller
const user = (await axios.get('/me')).data.data
```

### 2. Dùng wrapper unwrap

```ts
// ✅ ĐÚNG — wrapper tự unwrap, type-safe end-to-end
import { apiGet } from '@/services/api-client'
const users = await apiGet<User[]>('/users')  // User[], đã unwrap
```

Tên wrapper có thể khác (`apiGet`, `http.get`, `request<T>`, `$fetch`) — chọn theo convention project.

### 3. Check `success` qua throw, không qua if

Wrapper PHẢI throw error class (vd `ApiError`) khi `success === false`. Caller dùng try/catch, KHÔNG check `success` thủ công ở mỗi chỗ gọi.

```ts
// ❌ SAI — duplicate success check khắp codebase
const res = await apiGet<User>('/me')
if (!res.success) handleError(res.message)

// ✅ ĐÚNG — error tự throw, catch ở boundary (component, mutation, route handler)
try {
  const user = await apiGet<User>('/me')
} catch (e) {
  if (e instanceof ApiError) toast.error(e.message)
}
```

### 4. 3rd-party / external API: client riêng

External API (Stripe, Slack, GitHub, ...) thường KHÔNG dùng envelope này. KHÔNG nhét vào internal wrapper. Tạo client riêng:

```ts
// src/services/external-clients/stripe.ts
export const stripeClient = createExternalClient({ baseURL: 'https://api.stripe.com/v1' })
```

Wrapper internal chỉ áp dụng cho domain BE của project.

## Khi tạo wrapper mới

Nếu project chưa có wrapper, AI phải:
1. Hỏi user trước khi tạo: location (vd `src/lib/api-client.ts`, `src/services/axios.ts`), tên function, error class
2. Reuse pattern auth/retry/refresh **đã có** trong codebase nếu có (vd request interceptor đã đính Bearer token → đừng viết lại)
3. KHÔNG tạo wrapper duplicate khi đã có instance axios/fetch custom — extend file đó

Tham khảo skill `reuse-first.md` trước khi viết file mới.

## Khi migrate codebase cũ

Nếu codebase có nhiều chỗ `response.data.data ?? response.data`:
1. Confirm với user: BE wrap **nhất quán** mọi endpoint không?
2. Nếu nhất quán → xóa fallback, dùng wrapper unwrap mù
3. Nếu KHÔNG nhất quán → giữ fallback HOẶC dùng `createExternalClient` cho các endpoint không wrap

## Anti-patterns cấm

| Pattern | Vấn đề |
|---|---|
| `response.data.data ?? response.data` | Defensive thừa khi BE nhất quán; che giấu bug khi BE đổi shape |
| `if (res.data.success)` ở mỗi caller | Duplicate check; quên 1 chỗ là silent failure |
| `axios.get` raw ở file feature | Bypass wrapper, mất unwrap + auth + retry |
| Define lại `ApiEnvelope<T>` ở nhiều file | Vi phạm DRY; sai khi BE đổi field name |

## Liên quan

- `reuse-first.md` — check wrapper đã tồn tại trước khi tạo mới
- `development-rules.md` — kebab-case, file < 200 LOC, modularize

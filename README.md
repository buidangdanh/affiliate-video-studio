# Affiliate Radar & Veo Batch Studio — Săn Sản Phẩm Mùa Vụ Shopee/TikTok & Tạo Video AI

Hệ thống tích hợp **Săn Sản Phẩm Affiliate Mua Nhiều Theo Mùa (Shopee & TikTok Shop)** cập nhật tự động theo giờ/ngày, chấm điểm **Top 10 Sản Phẩm Tốt Nhất Mỗi Ngày**, lọc **Nhà Bán Hàng Uy Tín** và chuyển thẳng sang **Trình Tạo Video AI Hàng Loạt (9:16)**.

## Tính năng Săn Sản Phẩm Affiliate Theo Mùa (Mới)
- **Theo dõi theo mùa vụ & chiến dịch mua sắm**: Tự động nhận diện mùa hiện tại (Mùa Đông & Noel, Siêu Sale Cuối Năm, Tết Nguyên Đán, Mưa & Nồm Ẩm, Mùa Hè & Du Lịch, Tựu Trường, Tất Cả Mùa).
- **Cập nhật theo giờ & theo ngày (Realtime SSE)**:
  - Bộ lập lịch ngầm tự động cập nhật tốc độ bán mỗi giờ (`đơn/giờ`, `% tăng trưởng giờ`, biểu đồ 24h) và tổng hợp xu hướng 7 ngày.
  - Hỗ trợ **AI Quét Xu Hướng Thực Tế** bằng Google Gemini + Search Grounding và **Import CSV/JSON** từ Kalodata / Metric / Shopee Affiliate.
- **Tổng hợp dữ kiện mua bán & Nhà bán hàng uy tín**:
  - Phân tích tỷ lệ chuyển đổi KOC, độ cạnh tranh ngách, tỷ lệ đánh giá tích cực, tỷ lệ mua lại, tỷ lệ hoàn huỷ và khung giờ vàng đăng bài.
  - Xếp hạng các **gian hàng Mall / Yêu Thích+ / Star Shop** cho từng sản phẩm theo **Điểm Uy Tín (`/100`)**, tỷ lệ giao đúng hạn, tốc độ phản hồi chat, tồn kho và chính sách Sản Phẩm Mẫu (Free Sample).
- **Tự động chọn Top 10 sản phẩm tốt nhất mỗi ngày**:
  - Chấm điểm 4 trụ cột: *Độ khớp mùa vụ (25đ) + Tốc độ mua giờ/ngày (30đ) + Hiệu quả hoa hồng & cơ hội KOC (25đ) + Uy tín nhà bán hàng (20đ)*.
  - Đẩy lẻ từng sản phẩm hoặc **Đẩy cả Top 10 sang Tạo Video AI khung dọc 9:16** kèm kịch bản Hook 3 giây đầu chỉ với 1 cú click.

## Tính năng Tạo Video AI Hàng Loạt
- **Nhập danh sách job hàng loạt (20–50+ jobs)**:
  - Nhập trực tiếp và tuỳ chỉnh chi tiết từng dòng trong bảng.
  - Dán nhanh nhiều dòng prompt cùng lúc (mỗi dòng 1 job) hoặc import từ file `.csv` / `.json` (có file CSV mẫu).
  - Upload nhiều file ảnh cùng lúc để tự động sinh ra `N` job *Tạo video từ Hình ảnh*.
- **Đầy đủ thông số tuỳ chỉnh cho mỗi Job**:
  - **Prompt** mô tả chi tiết.
  - **Loại input**: `Tạo video từ Text` / `Tạo video từ Hình ảnh` (upload ảnh gốc) / `Tạo video từ Khung hình` (upload Khung hình đầu & Khung hình cuối).
  - **Model**: `Veo 3-Fast`, `Veo 3.1 Fast`, `Veo 3 Standard`, `Veo 3.1 Quality`, `Veo 2`.
  - **Tỉ lệ khung hình**: `16:9`, `9:16`, `1:1`, `4:3`, `3:4`.
  - **Số lượng đầu ra**: `1` – `8` video cho mỗi job.
- **Điều phối Hàng đợi & Giới hạn tốc độ tự động**:
  - Chạy song song tối đa `X` jobs cùng lúc (mặc định: **4 jobs**).
  - Giới hạn tốc độ cửa sổ trượt: tối đa `4 jobs / 1 phút` (60 giây), tự động đếm ngược và gửi tiếp job kế tiếp khi mở lượt cho đến khi hoàn tất 100% danh sách.
- **Quản lý kết quả, Retry & Download**:
  - Cập nhật tiến độ trực tiếp theo thời gian thực (SSE).
  - Nút **Retry** từng job bị lỗi hoặc **Retry tất cả lỗi**.
  - **Xem video trực tiếp trên web** (trình phát Cinema Modal hỗ trợ chuyển đổi nhiều đầu ra `#1..#n`).
  - Nút **Download MP4** cho từng video và **Download All (.ZIP)** tải toàn bộ video hoàn thành kèm file `manifest.json`.
- **2 Chế độ hoạt động**:
  - **Demo MP4 (Test ngay)**: Render file `.mp4` thật bằng FFmpeg theo đúng tỉ lệ khung hình và ảnh/khung hình đã upload để kiểm thử luồng hàng đợi ngay lập tức.
  - **Google Gemini API (Veo thật)**: Kết nối chính thức qua SDK `@google/genai` bằng Gemini API Key.

## Cách chạy dự án

```bash
# Cài đặt thư viện
npm install

# Chạy đồng thời Backend (port 3001) + Frontend (port 5173)
npm run dev
```

Mở trình duyệt tại: http://localhost:5173

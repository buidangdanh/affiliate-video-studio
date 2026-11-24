import type {
  AidaStage,
  FactorySceneItem,
  FactoryStylePreset,
  McOutfitPreset,
} from './factoryTypes.ts';

export const STYLE_PRESET_DESCRIPTIONS: Record<
  FactoryStylePreset,
  {
    label: string;
    shortLabel: string;
    settingPromptVi: string;
    mcContextVi: string;
  }
> = {
  factory_conveyor: {
    label: '🏭 Kho Xưởng & Dây Chuyền Sản Xuất (Chuẩn Xuân Chiến AI)',
    shortLabel: 'Kho Xưởng Băng Chuyền',
    settingPromptVi:
      'bối cảnh bên trong nhà máy lắp ráp hiện đại sáng rõ với dãy đèn tuýp LED trắng trên trần cao, băng chuyền PVC màu xanh lá đang chạy thẳng tắp với hàng loạt sản phẩm đồng bộ, phía sau có các công nhân mặc đồng phục đeo găng tay trắng đang kiểm tra chất lượng mờ nhẹ tự nhiên',
    mcContextVi: 'vào tận xưởng sản xuất săn trực tiếp không qua trung gian',
  },
  warehouse_flashsale: {
    label: '📦 Tổng Kho Xuất Hàng Ngàn Đơn (Xả Kho Giá Xưởng)',
    shortLabel: 'Tổng Kho Xuất Hàng',
    settingPromptVi:
      'bối cảnh bên trong tổng kho phân phối rộng lớn ánh sáng đèn LED trắng rõ nét, các dãy kệ pallet chất cao thùng carton đóng gói sẵn sàng xuất kho, nhân viên kho đẩy xe hàng nhộn nhịp phía xa',
    mcContextVi: 'đứng trực tiếp tại tổng kho phân phối chính hãng số lượng lớn',
  },
  home_real_pov: {
    label: '🏡 Trải Nghiệm Thực Tế Tại Nhà & Bếp Hiện Đại',
    shortLabel: 'Trải Nghiệm Tại Nhà',
    settingPromptVi:
      'bối cảnh căn bếp và phòng khách gia đình Việt hiện đại, mặt bàn gỗ sáng sạch sẽ, ánh sáng tự nhiên ban ngày chân thực như quay bằng iPhone cầm tay',
    mcContextVi: 'trải nghiệm và kiểm chứng trực tiếp tại nhà cho gia đình',
  },
};

export const MC_OUTFIT_DESCRIPTIONS: Record<
  McOutfitPreset,
  { label: string; outfitVi: string }
> = {
  cream_polo: {
    label: 'Áo Polo Kem + Quần Âu Đen (Thanh lịch, tôn sản phẩm sáng màu)',
    outfitVi:
      'MC nữ người Việt Nam khoảng 24 tuổi, làn da sáng tự nhiên, tóc đen dài uốn sóng nhẹ xoã gọn qua vai, gương mặt thân thiện tươi tắn, mặc áo thun polo có cổ màu kem nhã nhặn sơ vin gọn trong quần âu đen cạp cao',
  },
  navy_workwear: {
    label: 'Áo Khoác Kỹ Thuật Xưởng Xanh Navy (Uy tín nhà máy sản xuất)',
    outfitVi:
      'MC nữ người Việt Nam khoảng 24 tuổi, da sáng, tóc đen dài buộc gọn hoặc xoã nhẹ, gương mặt rạng rỡ đáng tin cậy, mặc áo khoác đồng phục kỹ thuật nhà máy màu xanh tím than (navy) phối quần tối màu gọn gàng',
  },
  brand_shirt: {
    label: 'Áo Sơ Mi Trắng Công Sở Trẻ Trung (Phù hợp mỹ phẩm & gia dụng cao cấp)',
    outfitVi:
      'MC nữ người Việt Nam khoảng 24 tuổi, da trắng hồng tự nhiên, tóc đen suôn mượt, nụ cười duyên dáng, mặc áo sơ mi trắng form chuẩn thanh lịch phối quần tây tối màu',
  },
};

export function buildMasterPromptVerbatim(
  productName: string,
  productHighlights: string,
  stylePreset: FactoryStylePreset,
  mcOutfitPreset: McOutfitPreset
): string {
  const styleInfo = STYLE_PRESET_DESCRIPTIONS[stylePreset];
  const outfitInfo = MC_OUTFIT_DESCRIPTIONS[mcOutfitPreset];

  return `HÃY PHÂN TÍCH SẢN PHẨM "${productName.toUpperCase()}" (${productHighlights || 'thiết kế hiện đại, bền bỉ, tiện dụng cho gia đình'}). TẠO CHO TÔI KỊCH BẢN VIDEO BÁN SẢN PHẨM NÀY THEO PHONG CÁCH ${styleInfo.shortLabel.toUpperCase()}, TRỰC TIẾP TẠI KHO XƯỞNG. ĐỘ DÀI 30S (5 PHÂN CẢNH x 6 GIÂY). CẤU TRÚC NỘI DUNG AIDA. YÊU CẦU TRONG CÂU LỆNH TẠO ẢNH (9:16), TẠO VIDEO MỖI PHÂN CẢNH PHẢI LÀM CHÍNH XÁC 100% HÌNH ẢNH SẢN PHẨM MẪU. ${outfitInfo.outfitVi.toUpperCase()}, ĐỒNG NHẤT TRANG PHỤC & BỐI CẢNH XUYÊN SUỐT 5 CẢNH. CÓ LỜI THOẠI TIẾNG VIỆT GIỚI THIỆU SẢN PHẨM KHỚP 6 GIÂY MỖI CẢNH.`;
}

export function composeThreeBlockVideoPrompt6s(params: {
  productName: string;
  actionAndCameraVi: string;
  spokenDialogueVi: string;
}): string {
  const cleanDialogue = params.spokenDialogueVi
    .trim()
    .replace(/^[“"']+|[”"']+$/g, '');

  return `Tạo video 6 giây từ chính ảnh tham chiếu, giữ nguyên 100% khuôn mặt MC, trang phục, bối cảnh nhà xưởng và đặc biệt giữ chính xác tuyệt đối hình dáng, màu sắc, tỷ lệ sản phẩm ${params.productName} không thay đổi chi tiết nào. ${params.actionAndCameraVi} Chuyển động mượt mà, chân thực như quay bằng điện thoại thực tế tại xưởng.

MC nói tiếng Việt, giọng nữ trẻ trung, tự nhiên, rõ ràng:
“${cleanDialogue}”

Không phụ đề, không chữ tự sinh, không biến dạng tay, không méo sản phẩm, không đổi logo, không thêm vật thể lạ.`;
}

export function buildFallback5SceneStoryboard(params: {
  productName: string;
  productHighlights?: string;
  stylePreset?: FactoryStylePreset;
  mcOutfitPreset?: McOutfitPreset;
}): {
  masterPromptUsed: string;
  scenes: FactorySceneItem[];
} {
  const productName = params.productName.trim() || 'Ấm Siêu Tốc Inox 304 Cao Cấp';
  const shortName =
    productName.split(' ').length > 7
      ? productName.split(' ').slice(0, 7).join(' ')
      : productName;
  const highlights =
    (params.productHighlights || '').trim() ||
    'chất liệu cao cấp bền đẹp, công suất mạnh mẽ, an toàn và tiết kiệm thời gian mỗi ngày';
  const stylePreset = params.stylePreset || 'factory_conveyor';
  const mcOutfitPreset = params.mcOutfitPreset || 'cream_polo';

  const styleInfo = STYLE_PRESET_DESCRIPTIONS[stylePreset];
  const mcInfo = MC_OUTFIT_DESCRIPTIONS[mcOutfitPreset];
  const masterPromptUsed = buildMasterPromptVerbatim(
    productName,
    highlights,
    stylePreset,
    mcOutfitPreset
  );

  const highlightParts = highlights
    .split(/[,;•\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const feat1 = highlightParts[0] || 'thiết kế tinh tế, chất liệu cao cấp cực kỳ bền bỉ';
  const feat2 = highlightParts[1] || 'công năng mạnh mẽ đáp ứng trọn vẹn nhu cầu cả gia đình';
  const feat3 = highlightParts[2] || 'vận hành êm ái, an toàn và cực kỳ tiện lợi mỗi ngày';

  const rawScenes: Array<{
    sceneNumber: number;
    aidaStage: AidaStage;
    title: string;
    cameraAngle: string;
    imagePrompt916: string;
    actionAndCameraVi: string;
    spokenDialogueVi: string;
  }> = [
    {
      sceneNumber: 1,
      aidaStage: 'Attention (Thu hút tại xưởng)',
      title: 'Cảnh 1: Hook vào tận dây chuyền xưởng săn hàng',
      cameraAngle: 'Trung toàn cảnh dọc 9:16 (Medium-Full Shot), push-in nhẹ',
      imagePrompt916: `Ảnh chụp thực tế bằng điện thoại tỉ lệ dọc 9:16, độ nét cao chân thực. ${mcInfo.outfitVi}, đứng bên cạnh dây chuyền sản xuất trong ${styleInfo.settingPromptVi}. Trên tay MC cầm chắc mẫu sản phẩm "${productName}" giống chính xác 100% ảnh sản phẩm mẫu về kiểu dáng, màu sắc và logo, trên băng chuyền phía sau cũng có hàng loạt sản phẩm "${shortName}" đồng bộ xếp nối tiếp nhau. Ánh sáng trắng nhà xưởng tự nhiên, rõ nét từng chi tiết.`,
      actionAndCameraVi: `MC đứng cạnh băng chuyền sản xuất đang di chuyển chậm phía sau, hai tay cầm chắc sản phẩm ${shortName} đưa nhẹ về phía trước giới thiệu với nụ cười tươi tự tin. Camera push-in nhẹ từ trung cảnh vào gần MC và sản phẩm.`,
      spokenDialogueVi: `Hôm nay em vào tận xưởng sản xuất săn trực tiếp cho anh chị mẫu ${shortName} đang cực hot này nhé.`,
    },
    {
      sceneNumber: 2,
      aidaStage: 'Interest (Chất liệu & Thiết kế)',
      title: 'Cảnh 2: Soi cận cảnh thiết kế & chất liệu hoàn thiện',
      cameraAngle: 'Trung cận cảnh 9:16 (Medium Close-Up), lấy nét chi tiết sản phẩm',
      imagePrompt916: `Bối cảnh tiếp tục chính xác nhà xưởng và ánh sáng của Cảnh 1. Ảnh chụp dọc 9:16 chân thực: vẫn chính xác ${mcInfo.outfitVi} của Cảnh 1 đang cầm sản phẩm "${productName}" giống hệt ảnh mẫu, một tay MC chỉ nhẹ vào phần bề mặt và chi tiết cấu tạo bên trong sản phẩm để khoe độ hoàn thiện sắc sảo (${feat1}). Phía sau trên băng chuyền xanh các công nhân đeo găng tay trắng đang kiểm tra hàng loạt chiếc "${shortName}" giống hệt nhau.`,
      actionAndCameraVi: `MC xoay nhẹ góc sản phẩm ${shortName} trên tay và dùng tay kia chỉ vào chi tiết thiết kế nổi bật để người xem thấy rõ chất liệu, phía sau công nhân kiểm hàng trên băng chuyền chuyển động tự nhiên. Camera giữ ổn định góc trung cận.`,
      spokenDialogueVi: `Mẫu ${shortName} này ghi điểm nhờ ${feat1}, cầm trên tay chắc chắn và vệ sinh cực kỳ tiện.`,
    },
    {
      sceneNumber: 3,
      aidaStage: 'Interest (Dung tích & Thông số)',
      title: 'Cảnh 3: Nêu bật thông số & quy mô dây chuyền',
      cameraAngle: 'Trung cảnh 9:16 góc nghiêng 15 độ dọc theo băng chuyền',
      imagePrompt916: `Bối cảnh tiếp tục chính xác nhà xưởng Cảnh 1. Ảnh dọc 9:16 chụp thực tế: giữ nguyên 100% khuôn mặt và trang phục MC của Cảnh 1 đứng dọc theo dây chuyền lắp ráp dài tắp đầy sản phẩm "${productName}" chuẩn mẫu. MC ôm gọn sản phẩm ngang ngực giúp thấy rõ kích thước thực tế cân đối so với cơ thể người, gương mặt hào hứng thuyết minh.`,
      actionAndCameraVi: `MC giữ sản phẩm ngang tầm ngực bên cạnh dây chuyền sản xuất nối dài phía sau, gật đầu nhẹ và thuyết minh tự nhiên về thông số. Camera lia nhẹ cực êm giữ trọn khung hình sản phẩm sắc nét.`,
      spokenDialogueVi: `Đặc biệt sản phẩm có ${feat2}, phục vụ thoải mái cho nhu cầu sử dụng hằng ngày của cả nhà.`,
    },
    {
      sceneNumber: 4,
      aidaStage: 'Desire (Test thực tế)',
      title: 'Cảnh 4: Demo trải nghiệm hoạt động trực quan',
      cameraAngle: 'Cận cảnh hành động 9:16 (Close-Up Action Demo)',
      imagePrompt916: `Bối cảnh tiếp tục chính xác bên trong khu vực kiểm thử chất lượng của nhà xưởng Cảnh 1. Ảnh dọc 9:16 chân thực: giữ nguyên 100% khuôn mặt và trang phục MC của Cảnh 1 đang trực tiếp thao tác sử dụng mẫu "${productName}" giống chính xác ảnh mẫu đặt trên bàn kiểm định sạch sẽ cạnh băng chuyền (${feat3}). Ánh sáng sắc nét tôn lên hiệu quả hoạt động thực tế của sản phẩm.`,
      actionAndCameraVi: `MC thao tác sử dụng trực tiếp sản phẩm ${shortName} một cách mượt mà để chứng minh hiệu quả thực tế, biểu cảm hài lòng. Camera close-up tập trung rõ nét vào sản phẩm và bàn tay thao tác chuẩn xác của MC.`,
      spokenDialogueVi: `Khi dùng thực tế máy cho hiệu quả ${feat3}, giúp anh chị tiết kiệm tối đa thời gian mỗi ngày.`,
    },
    {
      sceneNumber: 5,
      aidaStage: 'Action (Kho hàng & Chốt giỏ)',
      title: 'Cảnh 5: Tổng kho thùng hàng sẵn giao & Kêu gọi bấm giỏ hàng',
      cameraAngle: 'Trung cảnh 9:16 trước dãy thùng carton đóng gói xuất xưởng',
      imagePrompt916: `Bối cảnh khu vực kho đóng gói thành phẩm ngay trong nhà máy Cảnh 1 với nhiều kiện thùng carton nâu xếp ngay ngắn trên pallet phía sau. Ảnh dọc 9:16 chụp thực tế: giữ nguyên 100% khuôn mặt và trang phục MC của Cảnh 1 đang một tay cầm sản phẩm "${productName}" chuẩn mẫu, nụ cười rạng rỡ thân thiện nhìn thẳng vào ống kính mời đặt hàng.`,
      actionAndCameraVi: `MC đứng trước các dãy thùng hàng đóng gói sẵn tại kho xưởng, một tay nâng sản phẩm ${shortName}, tay kia chỉ nhẹ hướng xuống góc trái màn hình kêu gọi bấm giỏ hàng với nụ cười tươi. Camera giữ khung trung cảnh sắc nét.`,
      spokenDialogueVi: `Hàng tại xưởng đang sẵn kho ưu đãi tốt, anh chị bấm ngay vào giỏ hàng góc trái để đặt nhé!`,
    },
  ];

  const scenes: FactorySceneItem[] = rawScenes.map((s) => ({
    sceneNumber: s.sceneNumber,
    aidaStage: s.aidaStage,
    title: s.title,
    cameraAngle: s.cameraAngle,
    imagePrompt916: s.imagePrompt916,
    spokenDialogueVi: s.spokenDialogueVi,
    videoPrompt6s: composeThreeBlockVideoPrompt6s({
      productName: shortName,
      actionAndCameraVi: s.actionAndCameraVi,
      spokenDialogueVi: s.spokenDialogueVi,
    }),
    durationSeconds: 6,
    keyframeAsset: null,
    linkedJobId: null,
  }));

  return { masterPromptUsed, scenes };
}

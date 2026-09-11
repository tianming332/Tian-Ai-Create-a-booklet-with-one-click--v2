一键成册：文字排版更新（网页手动上传包）

请保持目录结构，将以下 7 个文件上传并覆盖 GitHub 仓库中的同路径文件：

src/engine/layout/templates.ts
src/engine/layout/generate.ts
src/engine/layout/aiPlan.ts
src/engine/grouping/group.ts
src/render/fonts.ts
src/render/preview.ts
src/shared/types.ts

本次更新内容：
1. 图文素材优先生成图文混排，不再集中产生连续 5–8 页纯文字。
2. 未匹配文字平均分散到图片组；规则排版和 AI 排版都会平衡独立文字页。
3. 满铺图片上的文字直接叠放在照片上，不添加底色、色块或渐变。
4. 根据文字实际落点下方的局部像素亮度自动选色：暗处白字，亮处黑字。
5. 所有文字统一使用无衬线黑体（Noto Sans SC / PingFang SC），不使用宋体。

注意：
- 不要整体删除或替换 src 文件夹，只覆盖上述 7 个文件。
- 上传部署后，需要重新执行排版；旧项目中已经生成的页面不会自动重新布局。

# tu-web-ts

当前项目的画板能力统一为 `X6`。

# roadmap
## dist 问题记录
git ignore 了/dist目录
但是如今富文本在npm run dev下会请求疑似build出来的dist目录下的文件
导致在进行一次build之前直接npm run dev ，富文本编辑器文件无法正确被请求到。
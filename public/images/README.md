# 图片资源目录说明

## 1) 全站背景图

- 文件路径：`public/images/campus-bg.jpg`
- 建议尺寸：`1920x1080` 或更高
- 建议大小：`300KB ~ 1.5MB`
- 推荐内容：校园广角、主楼、标志性景观

> 网站已内置虚化与暗化效果，你只需替换这张图。

## 2) 手绘图目录

- 目录路径：`public/images/drawings/`
- 命名建议：`地点id-序号.jpg`
  - 例如：`lib-old-a.jpg`、`main-building-01.png`

## 3) 路径写法

在 `data/places.json` 中填写 URL 时，使用：

- `"/images/campus-bg.jpg"`
- `"/images/drawings/lib-old-a.jpg"`

不要写本地磁盘绝对路径（如 `C:\...`）。
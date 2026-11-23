# 上游来源

这个目录是 [backnotprop/pstack](https://github.com/backnotprop/pstack) 的只读镜像，
用于让插件在离线状态下也能读到 58 个技能。

- 来源：https://github.com/backnotprop/pstack
- 快照：commit c3464c1（2026-11-20）
- 版本：见同目录 plugin.json 的 `version`
- 改动：无。这里的内容原样取自上游；本插件自己的东西都在上一级目录。

## 跟上游

```bash
git clone https://github.com/backnotprop/pstack /tmp/pstack
rsync -a --delete /tmp/pstack/skills/ repo/skills/
cp /tmp/pstack/plugin.json /tmp/pstack/README.md repo/
npm run sync      # 再把副本推到 ~/.dsh/skills 并检查漂移
```

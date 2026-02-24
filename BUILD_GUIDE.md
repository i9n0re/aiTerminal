# ttyd 编译与构建指南

本项目包含一个基于 React 的前端 UI 和一个基于 C 语言的后端程序。前端资源在编译时会被压缩并嵌入到 C 代码中，因此需要按照特定顺序进行构建。

---

## 1. 前端构建 (Frontend Build)

前端代码位于 `html/` 目录下。

### 环境要求
- **Node.js**: v14 或更高版本
- **Yarn**: 项目使用 Yarn 进行包管理（也可使用 npm）

### 构建步骤
1.  **安装依赖**:
    ```bash
    cd html
    yarn install
    ```
2.  **执行打包**:
    运行 Webpack 构建生产环境资源：
    ```bash
    npm run build
    ```
3.  **同步资源到后端 (关键步骤)**:
    由于原有的 `gulp` 流程在某些环境下存在路径兼容性问题，请使用我们创建的辅助脚本将生成的 `dist/index.html` 转换为 C 语言头文件 `src/html.h`：
    ```bash
    node gen_header.js
    ```
    *注意：此步骤会将前端资源进行 gzip 压缩并生成十六进制数组，这是后端编译的物理前提。*

---

## 2. 后端编译 (Backend Build)

后端是一个标准的 C 项目，使用 `CMake` 构建。

### 环境要求
确保系统已安装以下开发库：
- `cmake` (v3.12+)
- `libwebsockets-dev` (v3.2.0+)
- `libjson-c-dev`
- `libuv1-dev`
- `zlib1g-dev`

### 构建步骤
1.  **创建构建目录**:
    ```bash
    mkdir -p build && cd build
    ```
2.  **生成 Makefile**:
    ```bash
    cmake ..
    ```
3.  **编译程序**:
    ```bash
    make
    ```
    编译完成后，会在 `build/` 目录下生成名为 `ttyd` 的二进制文件。

---

## 3. 运行程序

在 `build/` 目录下，您可以使用以下命令启动服务：

```bash
# 示例：在 8080 端口启动并默认运行 bash
./ttyd -p 8080 bash
```

访问 `http://localhost:8080` 即可看到包含 **Windows Manager** 和 **Web Selection** 模式的新版 UI。

---

## 4. 故障排除 (Troubleshooting)

- **UI 修改未生效**: 确保在修改 React 代码后，先运行 `npm run build`，然后运行 `node gen_header.js`，最后在 `build` 目录下重新运行 `make`。
- **编译报错 `src/html.h` 缺失**: 请检查 `html/gen_header.js` 是否成功运行。
- **Tmux 功能不可用**: 请确保您的后端环境已安装 `tmux` 且 `ttyd` 启动时有足够的权限调用 `tmux` 命令。

---
*指南由 ttyd 专家组（架构师、系统工程师、前端工程师）联合起草。*

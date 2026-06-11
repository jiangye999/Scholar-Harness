; Custom NSIS uninstaller script for Scholar Harness
; Adds a prompt asking user whether to keep data during uninstall
; Reference: https://github.com/electron-userland/electron-builder/issues/4141

!macro customUnInstall
  ; 显示数据保留提示对话框
  ; /SD IDYES 表示静默卸载（自动更新）时默认保留数据
  MessageBox MB_YESNO "卸载完成！$\r$\n$\r$\n是否保留您的所有用户数据？$\r$\n$\r$\n保留内容：$\r$\n• 上传的文献库（PDF、文献列表）$\r$\n• 长期记忆（研究主题、实验资料、写作偏好）$\r$\n• 写作进度和章节规划$\r$\n• 已保存的草稿文件$\r$\n$\r$\n选择「是」保留所有数据，下次安装可继续使用。$\r$\n选择「否」完全清除所有数据。$\r$\n$\r$\n数据位置：%APPDATA%\Scholar Harness\data" \
    /SD IDYES IDYES KeepData IDNO DeleteData

  KeepData:
    ; 用户选择保留数据 - 不删除 AppData 目录
    ; 只删除程序文件，数据目录保留
    Goto done

  DeleteData:
    ; 用户选择删除数据 - 删除整个 AppData 目录
    RMDir /r "$APPDATA\${APP_FILENAME}"
    !ifdef APP_PRODUCT_FILENAME
      RMDir /r "$APPDATA\${APP_PRODUCT_FILENAME}"
    !endif
    Goto done

  done:
!macroend
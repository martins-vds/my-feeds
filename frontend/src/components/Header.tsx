/**
 * Header component with user avatar and sign-out
 */

import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  AppBar,
  Avatar,
  Box,
  Button,
  IconButton,
  Menu,
  MenuItem,
  Toolbar,
  Typography,
  ListItemIcon,
  ListItemText,
} from "@mui/material";
import {
  Logout as LogoutIcon,
  Settings as SettingsIcon,
  RssFeed as RssFeedIcon,
  Article as ArticleIcon,
} from "@mui/icons-material";
import { useAuth } from "../contexts/AuthContext";

export function Header() {
  const { user, logout, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  const handleLogout = async () => {
    handleMenuClose();
    await logout();
    navigate("/signin");
  };

  const handleSettings = () => {
    handleMenuClose();
    navigate("/settings");
  };

  const handleLogoClick = () => {
    navigate("/posts");
  };

  if (!isAuthenticated) {
    return null;
  }

  return (
    <AppBar position="sticky" color="default" elevation={1}>
      <Toolbar>
        {/* Logo */}
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            cursor: "pointer",
            flexGrow: 1,
          }}
          onClick={handleLogoClick}
        >
          <RssFeedIcon color="primary" sx={{ mr: 1 }} />
          <Typography variant="h6" component="span" fontWeight={600}>
            my-feeds
          </Typography>
        </Box>

        {/* Navigation Links */}
        <Box sx={{ display: "flex", gap: 0.5, mr: 2 }}>
          <Button
            startIcon={<ArticleIcon />}
            onClick={() => navigate("/posts")}
            color={location.pathname.startsWith("/posts") ? "primary" : "inherit"}
            variant={location.pathname.startsWith("/posts") ? "contained" : "text"}
            size="small"
            data-testid="nav-posts"
          >
            Posts
          </Button>
          <Button
            startIcon={<RssFeedIcon />}
            onClick={() => navigate("/feeds")}
            color={location.pathname.startsWith("/feeds") ? "primary" : "inherit"}
            variant={location.pathname.startsWith("/feeds") ? "contained" : "text"}
            size="small"
            data-testid="nav-feeds"
          >
            Feeds
          </Button>
        </Box>

        {/* User Menu */}
        {user && (
          <>
            <IconButton onClick={handleMenuOpen} data-testid="user-avatar" sx={{ p: 0.5 }}>
              <Avatar
                alt={user.name || user.email}
                src={user.avatarUrl || undefined}
                sx={{ width: 36, height: 36 }}
              >
                {(user.name || user.email).charAt(0).toUpperCase()}
              </Avatar>
            </IconButton>

            <Menu
              anchorEl={anchorEl}
              open={Boolean(anchorEl)}
              onClose={handleMenuClose}
              transformOrigin={{ horizontal: "right", vertical: "top" }}
              anchorOrigin={{ horizontal: "right", vertical: "bottom" }}
            >
              <Box sx={{ px: 2, py: 1 }}>
                <Typography variant="subtitle2" fontWeight={600}>
                  {user.name || "User"}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {user.email}
                </Typography>
              </Box>

              <MenuItem onClick={handleSettings}>
                <ListItemIcon>
                  <SettingsIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>Settings</ListItemText>
              </MenuItem>

              <MenuItem onClick={handleLogout}>
                <ListItemIcon>
                  <LogoutIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>Sign out</ListItemText>
              </MenuItem>
            </Menu>
          </>
        )}
      </Toolbar>
    </AppBar>
  );
}

export default Header;

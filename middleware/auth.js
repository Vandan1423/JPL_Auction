export const isAuthenticated = (req, res, next) => {
  // Check if session exists and is admin
  if (req.session && req.session.isAdmin === true) {
    // Touch the session to extend its life
    req.session.touch();
    return next();
  }

  // Handle AJAX requests differently
  if (req.xhr || req.headers.accept?.indexOf('json') > -1) {
    return res.status(401).json({ 
      error: 'Authentication required',
      redirect: '/admin/login'
    });
  }

  // For regular requests, set error and redirect
  if (req.session) {
    req.session.error = 'Please login to access this page';
  }
  res.redirect('/admin/login');
};

export const isNotAuthenticated = (req, res, next) => {
  if (req.session && req.session.isAdmin === true) {
    return res.redirect('/admin/dashboard');
  }
  next();
};
